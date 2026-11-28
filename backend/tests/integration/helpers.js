const crypto = require('crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const { prisma, disconnectPrisma } = require('../../src/config/prisma');

let counter = 0;

function uniqueTag(prefix = 'it') {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}_${crypto.randomBytes(3).toString('hex')}`;
}

function uniqueNpi() {
  counter += 1;
  const tail = String((Date.now() % 10000000) * 10 + (counter % 10)).padStart(8, '0').slice(-8);
  return `99${tail}`;
}

function createTracker() {
  return {
    auditLogIds: [],
    codingSuggestionIds: [],
    validationResultIds: [],
    denialRiskIds: [],
    reportIds: [],
    claimIds: [],
    medicalRecordIds: [],
    aiAnalysisIds: [],
    encounterIds: [],
    patientIds: [],
    providerIds: [],
    rateReferenceIds: [],
    insurancePlanIds: [],
    payerIds: [],
    userIds: [],
  };
}

async function cleanupTracked(tracker) {
  if (!tracker) return;

  if (tracker.auditLogIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: tracker.auditLogIds } } });
  }
  if (tracker.userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: tracker.userIds } } });
    await prisma.auditLog.deleteMany({
      where: { entity: 'USER', entityId: { in: tracker.userIds } },
    });
  }
  if (tracker.encounterIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity: 'ENCOUNTER', entityId: { in: tracker.encounterIds } },
    });
  }
  if (tracker.patientIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity: 'PATIENT', entityId: { in: tracker.patientIds } },
    });
  }
  if (tracker.providerIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity: 'PROVIDER', entityId: { in: tracker.providerIds } },
    });
  }

  if (tracker.codingSuggestionIds.length > 0) {
    await prisma.codingSuggestion.deleteMany({
      where: { id: { in: tracker.codingSuggestionIds } },
    });
  }
  if (tracker.validationResultIds.length > 0) {
    await prisma.validationResult.deleteMany({
      where: { id: { in: tracker.validationResultIds } },
    });
  }
  if (tracker.denialRiskIds.length > 0) {
    await prisma.denialRisk.deleteMany({
      where: { id: { in: tracker.denialRiskIds } },
    });
  }
  if (tracker.reportIds.length > 0) {
    await prisma.report.deleteMany({ where: { id: { in: tracker.reportIds } } });
  }
  if (tracker.claimIds.length > 0) {
    await prisma.claimStatusHistory.deleteMany({
      where: { claimId: { in: tracker.claimIds } },
    });
    await prisma.claim.deleteMany({ where: { id: { in: tracker.claimIds } } });
  }
  if (tracker.medicalRecordIds.length > 0) {
    await prisma.medicalRecord.deleteMany({
      where: { id: { in: tracker.medicalRecordIds } },
    });
  }
  if (tracker.aiAnalysisIds.length > 0) {
    await prisma.aiAnalysis.deleteMany({
      where: { id: { in: tracker.aiAnalysisIds } },
    });
  }
  if (tracker.encounterIds.length > 0) {
    await prisma.encounter.deleteMany({
      where: { id: { in: tracker.encounterIds } },
    });
  }
  if (tracker.patientIds.length > 0) {
    await prisma.patient.deleteMany({ where: { id: { in: tracker.patientIds } } });
  }
  if (tracker.providerIds.length > 0) {
    await prisma.provider.deleteMany({ where: { id: { in: tracker.providerIds } } });
  }
  if (tracker.rateReferenceIds.length > 0) {
    await prisma.rateReference.deleteMany({
      where: { id: { in: tracker.rateReferenceIds } },
    });
  }
  if (tracker.insurancePlanIds.length > 0) {
    await prisma.insurancePlan.deleteMany({
      where: { id: { in: tracker.insurancePlanIds } },
    });
  }
  if (tracker.payerIds.length > 0) {
    await prisma.payer.deleteMany({ where: { id: { in: tracker.payerIds } } });
  }
  if (tracker.userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: tracker.userIds } } });
  }
}

async function loginSeededAdmin() {
  const res = await request(app).post('/api/v1/auth/login').send({
    email: 'admin.demo@medcodeai.local',
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(`Seeded admin login failed with status ${res.status}`);
  }
  return { token: res.body.data.token, user: res.body.data.user };
}

async function createSyntheticUser(tracker, roleName = 'CODER', overrides = {}) {
  const tag = uniqueTag('usr');
  const password = overrides.password || 'StrongPass#2026!';
  const passwordHash = await bcrypt.hash(password, 10);
  let roleId = overrides.roleId ?? null;
  if (roleName && roleId === null && overrides.accountStatus !== 'PENDING') {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new Error(`Role ${roleName} not found`);
    roleId = role.id;
  }

  const user = await prisma.user.create({
    data: {
      name: overrides.name || `Integration ${tag}`,
      email: (overrides.email || `${tag}@medcodeai.test`).toLowerCase(),
      passwordHash,
      roleId,
      isActive: overrides.isActive ?? true,
      accountStatus: overrides.accountStatus || 'APPROVED',
    },
    include: { role: true },
  });
  tracker.userIds.push(user.id);
  return { user, password };
}

async function loginUser(email, password) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

function barrier(count) {
  let arrived = 0;
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) {
      release();
    }
    await promise;
  };
}

module.exports = {
  app,
  prisma,
  disconnectPrisma,
  request,
  jwt,
  bcrypt,
  uniqueTag,
  uniqueNpi,
  createTracker,
  cleanupTracked,
  loginSeededAdmin,
  createSyntheticUser,
  loginUser,
  barrier,
};
