import { PrismaClient } from '@prisma/client';
import { getCurrentCoupleId } from './lib/tenant-context';

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma;
}

const TENANT_MODELS = new Set([
  'CountdownEvent',
  'PeriodRecord',
  'PeriodSettings',
  'PeriodDailyLog',
  'CoupleCheckIn',
  'RelationshipNotificationCopy',
  'WishItem',
  'GachaEgg',
  'GachaDraw',
  'GachaDailyState',
  'TimelineNode',
  'ChatMessage',
  'ChatMessageFavorite',
  'ChatSticker',
  'ChatReadState',
  'AiChatMessage',
  'AiMemory',
  'MemoryReport',
  'DeviceSession',
  'VanishingTicTacToeGame',
  'DrawGuessRound',
  'DrawGuessAttempt',
  'TruthOrDareRound',
  'TruthOrDareQuestion',
  'CouplePet',
  'PetActivity',
  'PetLetter',
  'PetOwnedItem',
  'PetRoomPlacement',
  'PetFacility',
]);

/**
 * Defense-in-depth tenant isolation. Authenticated work runs inside
 * AsyncLocalStorage couple context so forgotten filters cannot cross tenants.
 */
export const prisma: PrismaClient = basePrisma.$extends({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const coupleId = getCurrentCoupleId();
        if (!coupleId || !TENANT_MODELS.has(model)) {
          return query(args);
        }

        const scoped = { ...(args as Record<string, any>) };
        const withCoupleWhere = {
          ...(scoped.where ?? {}),
          coupleId,
        };
        const run = query as (nextArgs: unknown) => Promise<unknown>;

        if (
          operation === 'findUnique' ||
          operation === 'findUniqueOrThrow' ||
          operation === 'findFirst' ||
          operation === 'findFirstOrThrow' ||
          operation === 'findMany' ||
          operation === 'count' ||
          operation === 'aggregate' ||
          operation === 'groupBy' ||
          operation === 'update' ||
          operation === 'updateMany' ||
          operation === 'delete' ||
          operation === 'deleteMany'
        ) {
          scoped.where = withCoupleWhere;
          if (operation === 'update' || operation === 'updateMany') {
            scoped.data = { ...(scoped.data ?? {}), coupleId };
          }
          return run(scoped);
        }

        if (operation === 'create') {
          scoped.data = { ...(scoped.data ?? {}), coupleId };
          return run(scoped);
        }

        if (operation === 'createMany') {
          const rows = Array.isArray(scoped.data) ? scoped.data : [scoped.data];
          scoped.data = rows.map((row: Record<string, unknown>) => ({
            ...row,
            coupleId,
          }));
          return run(scoped);
        }

        if (operation === 'upsert') {
          scoped.where = withCoupleWhere;
          scoped.create = { ...(scoped.create ?? {}), coupleId };
          scoped.update = { ...(scoped.update ?? {}), coupleId };
          return run(scoped);
        }

        return run(args);
      },
    },
  },
}) as unknown as PrismaClient;
