const {
  prisma,
  disconnectPrisma,
  uniqueTag,
  uniqueNpi,
  createTracker,
  cleanupTracked,
  createSyntheticUser,
} = require('./helpers');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../../src/modules/audit');
const UserService = require('../../src/modules/users/user.service');
const {
  startCoding,
  markValidated,
} = require('../../src/modules/encounters');

describe('Integration: Real PostgreSQL Transaction Rollback & Atomicity', () => {
  const tracker = createTracker();

  afterEach(async () => {
    await cleanupTracked(tracker);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  test('Commits business mutation + audit log atomically on success, and rolls back business mutation on forced audit failure', async () => {
    const tag = uniqueTag('tx');

    // 1. Successful atomic commit (Patient + AuditLog inside prisma.$transaction)
    const committed = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          name: `Tx Commit ${tag}`,
          dob: new Date('1990-01-01'),
          gender: 'Female',
          memberId: `MEM-${tag}`,
        },
      });
      const audit = await AuditService.log(
        {
          userId: null,
          action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
          entity: AUDIT_ENTITIES.PATIENT,
          entityId: patient.id,
        },
        { tx }
      );
      return { patient, audit };
    });
    tracker.patientIds.push(committed.patient.id);
    tracker.auditLogIds.push(committed.audit.id);

    expect(await prisma.patient.findUnique({ where: { id: committed.patient.id } })).not.toBeNull();

    // 2. Forced audit failure (null userId for PATIENT_CREATED) rolls back Patient insert in PostgreSQL
    const rolledBackName = `Tx Rollback ${tag}`;
    await expect(
      prisma.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            name: rolledBackName,
            dob: new Date('1990-01-01'),
            gender: 'Male',
            memberId: `MEM-RB-${tag}`,
          },
        });
        await AuditService.log(
          {
            userId: null, // Invalid for non-auth business mutation -> throws
            action: AUDIT_ACTIONS.PATIENT_CREATED,
            entity: AUDIT_ENTITIES.PATIENT,
            entityId: patient.id,
          },
          { tx }
        );
      })
    ).rejects.toThrow();

    expect(await prisma.patient.findFirst({ where: { name: rolledBackName } })).toBeNull();
  });

  test('Failed account approval, failed password update, failed encounter transition, and failed deletion leave DB unchanged', async () => {
    const tag = uniqueTag('rb');
    const { user: admin } = await createSyntheticUser(tracker, 'ADMIN');
    const { user: pending } = await createSyntheticUser(tracker, null, {
      accountStatus: 'PENDING',
      roleId: null,
    });

    // Failed approval (invalid role) leaves account PENDING with null roleId
    await expect(
      UserService.approveUser(
        pending.id,
        { role: 'NON_EXISTENT_ROLE' },
        { userId: admin.id, role: 'ADMIN', ipAddress: '127.0.0.1' }
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    const dbPending = await prisma.user.findUnique({ where: { id: pending.id } });
    expect(dbPending.accountStatus).toBe('PENDING');
    expect(dbPending.roleId).toBeNull();

    // Failed password update leaves passwordHash and tokenVersion unchanged
    const { user: staff } = await createSyntheticUser(tracker, 'CODER');
    await expect(
      UserService.changePassword(
        staff.id,
        { currentPassword: 'WrongPassword!', newPassword: 'NewStrongPassword#2026!' },
        { userId: staff.id, role: 'CODER', ipAddress: '127.0.0.1' }
      )
    ).rejects.toMatchObject({ statusCode: 401 });

    const dbStaff = await prisma.user.findUnique({ where: { id: staff.id } });
    expect(dbStaff.passwordHash).toBe(staff.passwordHash);
    expect(dbStaff.tokenVersion).toBe(0);

    // Failed encounter transition (startCoding without MedicalRecord) leaves status OPEN
    const patient = await prisma.patient.findFirst();
    const provider = await prisma.provider.findFirst();
    const plan = await prisma.insurancePlan.findFirst();
    const enc = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-04'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc.id);

    await expect(
      startCoding(enc.id, { userId: staff.id, role: 'CODER', ipAddress: '127.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'CODING_PREREQUISITE_MISSING' });

    await expect(
      markValidated(enc.id, { userId: staff.id, role: 'CODER', ipAddress: '127.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATUS_TRANSITION' });

    const dbEnc = await prisma.encounter.findUnique({ where: { id: enc.id } });
    expect(dbEnc.status).toBe('OPEN');

    // Failed deletion (provider with encounter) leaves provider intact
    const prov = await prisma.provider.create({
      data: { name: `Prov ${tag}`, npi: uniqueNpi(), specialty: 'Surgery' },
    });
    tracker.providerIds.push(prov.id);

    const enc2 = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: prov.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-04'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc2.id);

    await expect(prisma.provider.delete({ where: { id: prov.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    expect(await prisma.provider.findUnique({ where: { id: prov.id } })).not.toBeNull();
  });
});
