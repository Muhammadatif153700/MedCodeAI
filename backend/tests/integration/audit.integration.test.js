const {
  app,
  prisma,
  disconnectPrisma,
  request,
  uniqueTag,
  uniqueNpi,
  createTracker,
  cleanupTracked,
  loginSeededAdmin,
  createSyntheticUser,
  loginUser,
} = require('./helpers');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../../src/modules/audit');

describe('Integration: Audit Logging (Real PostgreSQL)', () => {
  const tracker = createTracker();
  let adminToken;

  beforeAll(async () => {
    adminToken = (await loginSeededAdmin()).token;
  });

  afterAll(async () => {
    await cleanupTracked(tracker);
    await disconnectPrisma();
  });

  test('Persists real audit_logs for security & CRUD events, preserves null-actor unknown logins, blocks null-actor business mutations, and restricts audit API to ADMIN', async () => {
    const tag = uniqueTag('aud');
    const { user: coder, password: coderPw } = await createSyntheticUser(tracker, 'CODER');

    // Non-admin blocked from GET /api/v1/audit-logs
    const coderLogin = await loginUser(coder.email, coderPw);
    expect(coderLogin.status).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v1/audit-logs')
          .set('Authorization', `Bearer ${coderLogin.body.data.token}`)
      ).status
    ).toBe(403);

    // Known-user failed login
    await loginUser(coder.email, 'WrongPass#123');

    // Unknown-user failed login -> userId = null
    await loginUser(`${tag}_unknown@medcodeai.test`, 'WrongPass#123');
    const nullLoginAudit = await prisma.auditLog.findFirst({
      where: { userId: null, action: 'USER_LOGIN_FAILED' },
      orderBy: { id: 'desc' },
    });
    expect(nullLoginAudit).not.toBeNull();
    expect(nullLoginAudit.entity).toBe('USER');
    expect(nullLoginAudit.entityId).toBeNull();
    tracker.auditLogIds.push(nullLoginAudit.id);

    // Null actor rejected for normal business mutations
    await expect(
      AuditService.log({
        userId: null,
        action: AUDIT_ACTIONS.PATIENT_CREATED,
        entity: AUDIT_ENTITIES.PATIENT,
        entityId: 1,
      })
    ).rejects.toThrow();

    // Admin approval, role assignment, disable, profile update, password change
    const regRes = await request(app).post('/api/v1/auth/register').send({
      name: `Audit Target ${tag}`,
      email: `${tag}@medcodeai.test`,
      password: 'TargetPass#2026!',
    });
    const targetId = regRes.body.data.user.id;
    tracker.userIds.push(targetId);

    await request(app)
      .patch(`/api/v1/users/${targetId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'REVIEWER' });
    await request(app)
      .patch(`/api/v1/users/${targetId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'BILLING_SPECIALIST' });
    await request(app)
      .patch(`/api/v1/users/${targetId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${coderLogin.body.data.token}`)
      .send({ name: `Coder Updated ${tag}` });
    await request(app)
      .patch('/api/v1/profile/password')
      .set('Authorization', `Bearer ${coderLogin.body.data.token}`)
      .send({ currentPassword: coderPw, newPassword: 'CoderNewPass#2026!' });

    // Patient & Provider CRUD
    const patRes = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Aud Pat ${tag}`,
        dob: '1992-05-05',
        gender: 'Female',
        memberId: `MEM-${tag}`,
      });
    tracker.patientIds.push(patRes.body.data.patient.id);

    const provRes = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Aud Prov ${tag}`, npi: uniqueNpi(), specialty: 'General' });
    tracker.providerIds.push(provRes.body.data.provider.id);

    // Verify audit logs in DB
    const coderAudits = await prisma.auditLog.findMany({
      where: { userId: coder.id },
      orderBy: { id: 'asc' },
    });
    const coderActions = coderAudits.map((a) => a.action);
    expect(coderActions).toEqual(
      expect.arrayContaining([
        'USER_LOGIN_SUCCESS',
        'USER_LOGIN_FAILED',
        'USER_PROFILE_UPDATED',
        'USER_PASSWORD_CHANGED',
      ])
    );

    const targetAudits = await prisma.auditLog.findMany({
      where: { entity: 'USER', entityId: targetId },
    });
    const targetActions = targetAudits.map((a) => a.action);
    expect(targetActions).toEqual(
      expect.arrayContaining([
        'USER_REGISTERED',
        'USER_ACCOUNT_APPROVED',
        'USER_ROLE_ASSIGNED',
        'USER_ACCOUNT_DISABLED',
      ])
    );

    // Admin audit retrieval endpoint & safe null-actor serialization
    const listAudits = await request(app)
      .get('/api/v1/audit-logs?action=USER_LOGIN_FAILED&limit=20')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAudits.status).toBe(200);
    const nullRow = listAudits.body.data.find((l) => l.id === nullLoginAudit.id);
    expect(nullRow).toBeDefined();
    expect(nullRow.user).toBeNull();
    expect(JSON.stringify(listAudits.body)).not.toContain('StrongPass');
    expect(JSON.stringify(listAudits.body)).not.toContain('CoderNewPass');
  });
});
