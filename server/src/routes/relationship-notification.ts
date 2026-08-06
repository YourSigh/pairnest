import { Router } from "express";

import { prisma } from "../db";
import { getAuthenticatedRole, getCoupleId } from "../middleware/auth";
import { broadcastRelationshipNotification } from "../ws";

export const relationshipNotificationRouter = Router();

type CoupleRole = "female" | "male";

function partnerRole(role: CoupleRole): CoupleRole {
  return role === "female" ? "male" : "female";
}

function toDto(item: {
  targetRole: string;
  authorRole: string;
  content: string;
  updatedAt: Date;
} | null) {
  if (!item) return null;
  return {
    targetRole: item.targetRole,
    authorRole: item.authorRole,
    content: item.content,
    updatedAt: item.updatedAt.toISOString(),
  };
}

relationshipNotificationRouter.get("/", async (req, res) => {
  const coupleId = getCoupleId(res);
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 必须为 female 或 male" });
    return;
  }

  const [incoming, outgoing] = await Promise.all([
    prisma.relationshipNotificationCopy.findUnique({
      where: { coupleId_targetRole: { coupleId, targetRole: role } },
    }),
    prisma.relationshipNotificationCopy.findUnique({
      where: { coupleId_targetRole: { coupleId, targetRole: partnerRole(role) } },
    }),
  ]);
  res.json({ ok: true, incoming: toDto(incoming), outgoing: toDto(outgoing) });
});

relationshipNotificationRouter.put("/", async (req, res) => {
  const coupleId = getCoupleId(res);
  const authorRole = getAuthenticatedRole(res);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!authorRole) {
    res.status(400).json({ ok: false, message: "authorRole 必须为 female 或 male" });
    return;
  }
  if (!content) {
    res.status(400).json({ ok: false, message: "通知文案不能为空" });
    return;
  }
  if (content.length > 80) {
    res.status(400).json({ ok: false, message: "通知文案最多 80 个字" });
    return;
  }

  const targetRole = partnerRole(authorRole);
  const item = await prisma.relationshipNotificationCopy.upsert({
    where: { coupleId_targetRole: { coupleId, targetRole } },
    create: { coupleId, targetRole, authorRole, content },
    update: { authorRole, content },
  });
  const dto = toDto(item)!;
  broadcastRelationshipNotification(coupleId, dto);
  res.json({ ok: true, item: dto });
});
