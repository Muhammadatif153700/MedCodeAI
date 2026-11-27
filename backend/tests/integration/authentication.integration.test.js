const {
  app,
  prisma,
  disconnectPrisma,
  request,
  jwt,
  bcrypt,
  uniqueTag,
  createTracker,
  cleanupTracked,
  loginSeededAdmin,
  createSyntheticUser,
  loginUser,
} = require('./helpers');

describe('Integration: Authentication & JWT (Real PostgreSQL)', () => {
  const tracker = createTracker();

  afterEach(async () => {
    await cleanupTracked(tracker);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  test('Public registration normalizes email, stores bcrypt hash, defaults to PENDING with null roleId, and rejects duplicates', async () => {
    const tag = uniqueTag('reg');
    const rawEmail = `  ${tag.toUpperCase()}@MedCodeAI.Test `;
    const normalizedEmail = `${tag}@medcodeai.test`;
    const password = 'RegisterPass#2026!';

    const regRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Integration Registrant',
      email: rawEmail,
      password,
    });

    expect(regRes.status).toBe(201);
    const createdUser = regRes.body.data.user;
    tracker.userIds.push(createdUser.id);

    expect(createdUser.email).toBe(normalizedEmail);
    expect(createdUser.accountStatus).toBe('PENDING');
    expect(createdUser.role).toBeNull();
    expect(createdUser.passwordHash).toBeUndefined();
    expect(createdUser.tokenVersion).toBeUndefined();

    const dbUser = await prisma.user.findUnique({ where: { id: createdUser.id } });
    expect(dbUser).not.toBeNull();
    expect(dbUser.email).toBe(normalizedEmail);
    expect(dbUser.accountStatus).toBe('PENDING');
    expect(dbUser.roleId).toBeNull();
    expect(dbUser.tokenVersion).toBe(0);
    expect(await bcrypt.compare(password, dbUser.passwordHash)).toBe(true);

    const regAudit = await prisma.auditLog.findFirst({
      where: { entity: 'USER', entityId: createdUser.id, action: 'USER_REGISTERED' },
    });
    expect(regAudit).not.toBeNull();
    tracker.auditLogIds.push(regAudit.id);

    // Duplicate email rejected (case/whitespace variant)
    const dupRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Duplicate User',
      email: normalizedEmail.toUpperCase(),
      password,
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

    // Pending account cannot log in
    const pendingLogin = await loginUser(normalizedEmail, password);
    expect(pendingLogin.status).toBe(403);
    expect(pendingLogin.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  test('Handles unknown-email, wrong-password, disabled, and rejected login rejections with audit logs', async () => {
    // Unknown email
    const unknownEmail = `${uniqueTag('unknown')}@medcodeai.test`;
    const unknownRes = await loginUser(unknownEmail, 'SomePassword123!');
    expect(unknownRes.status).toBe(401);
    expect(unknownRes.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknownAudit = await prisma.auditLog.findFirst({
      where: { userId: null, action: 'USER_LOGIN_FAILED' },
      orderBy: { id: 'desc' },
    });
    expect(unknownAudit).not.toBeNull();
    tracker.auditLogIds.push(unknownAudit.id);

    // Known user wrong password
    const { user: coderUser, password } = await createSyntheticUser(tracker, 'CODER');
    const badPwRes = await loginUser(coderUser.email, 'WrongPassword#999');
    expect(badPwRes.status).toBe(401);
    expect(badPwRes.body.error.code).toBe('INVALID_CREDENTIALS');

    const knownFailAudit = await prisma.auditLog.findFirst({
      where: { userId: coderUser.id, action: 'USER_LOGIN_FAILED' },
    });
    expect(knownFailAudit).not.toBeNull();

    // Disabled account
    const { user: disabledUser, password: disabledPw } = await createSyntheticUser(
      tracker,
      'REVIEWER',
      { isActive: false }
    );
    const disabledRes = await loginUser(disabledUser.email, disabledPw);
    expect(disabledRes.status).toBe(403);
    expect(disabledRes.body.error.code).toBe('ACCOUNT_DISABLED');

    // Rejected account
    const { user: rejectedUser, password: rejectedPw } = await createSyntheticUser(
      tracker,
      null,
      { accountStatus: 'REJECTED', roleId: null }
    );
    const rejectedRes = await loginUser(rejectedUser.email, rejectedPw);
    expect(rejectedRes.status).toBe(403);
    expect(rejectedRes.body.error.code).toBe('ACCOUNT_REJECTED');
  });

  test('Admin and staff logins issue valid tv-claimed JWTs, /auth/me succeeds, and invalid/expired/mismatched JWTs are rejected', async () => {
    const adminLogin = await loginSeededAdmin();
    const decodedAdmin = jwt.decode(adminLogin.token);
    expect(decodedAdmin.sub).toBeDefined();
    expect(decodedAdmin.tv).toBe(0);

    const meAdmin = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expect(meAdmin.status).toBe(200);
    expect(meAdmin.body.data.user.role).toBe('ADMIN');
    expect(meAdmin.body.data.user.passwordHash).toBeUndefined();
    expect(meAdmin.body.data.user.tokenVersion).toBeUndefined();

    // Staff login
    const { user: staffUser, password: staffPw } = await createSyntheticUser(
      tracker,
      'BILLING_SPECIALIST'
    );
    const staffLogin = await loginUser(staffUser.email, staffPw);
    expect(staffLogin.status).toBe(200);
    const staffToken = staffLogin.body.data.token;
    const decodedStaff = jwt.decode(staffToken);
    expect(decodedStaff.tv).toBe(0);
    expect(staffLogin.body.data.user.passwordHash).toBeUndefined();
    expect(staffLogin.body.data.user.tokenVersion).toBeUndefined();

    const meStaff = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(meStaff.status).toBe(200);
    expect(meStaff.body.data.user.email).toBe(staffUser.email);

    // Invalid JWT
    const invalidRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.jwt.token');
    expect(invalidRes.status).toBe(401);

    // Expired JWT
    const expiredToken = jwt.sign(
      { sub: String(staffUser.id), role: 'BILLING_SPECIALIST', tv: 0 },
      process.env.JWT_SECRET,
      {
        expiresIn: -10,
        issuer: process.env.JWT_ISSUER || 'medcodeai-api',
        audience: process.env.JWT_AUDIENCE || 'medcodeai-client',
      }
    );
    const expiredRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(expiredRes.status).toBe(401);

    // Missing tv claim
    const missingTvToken = jwt.sign(
      { sub: String(staffUser.id), role: 'BILLING_SPECIALIST' },
      process.env.JWT_SECRET,
      {
        expiresIn: '1h',
        issuer: process.env.JWT_ISSUER || 'medcodeai-api',
        audience: process.env.JWT_AUDIENCE || 'medcodeai-client',
      }
    );
    const missingTvRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${missingTvToken}`);
    expect(missingTvRes.status).toBe(401);

    // Mismatched tv claim
    const wrongTvToken = jwt.sign(
      { sub: String(staffUser.id), role: 'BILLING_SPECIALIST', tv: 99 },
      process.env.JWT_SECRET,
      {
        expiresIn: '1h',
        issuer: process.env.JWT_ISSUER || 'medcodeai-api',
        audience: process.env.JWT_AUDIENCE || 'medcodeai-client',
      }
    );
    const wrongTvRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${wrongTvToken}`);
    expect(wrongTvRes.status).toBe(401);
  });
});
