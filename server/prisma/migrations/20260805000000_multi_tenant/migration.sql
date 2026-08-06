-- Multi-tenant migration: add Couple isolation to all business tables.
--
-- MySQL DDL is not transactional.  Keep dependency removal, data backfill, and
-- constraint recreation in this order so a populated v0.1 database can be
-- upgraded without dropping an index that is still required by a foreign key.

CREATE TABLE `Couple` (
    `id` VARCHAR(64) NOT NULL,
    `pairingCodeHash` VARCHAR(64) NULL,
    `recoveryCodeHash` VARCHAR(64) NULL,
    `pairingCodeExpiresAt` DATETIME(3) NULL,
    `pairingTargetRole` ENUM('partnerA', 'partnerB') NULL,
    `pairingPurpose` VARCHAR(16) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `deletionRequestedBy` ENUM('partnerA', 'partnerB') NULL,
    `deletionRequestedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Couple_pairingCodeHash_key`(`pairingCodeHash`),
    UNIQUE INDEX `Couple_recoveryCodeHash_key`(`recoveryCodeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Couple` (`id`, `pairingCodeHash`, `recoveryCodeHash`, `status`, `createdAt`, `updatedAt`)
SELECT 'legacy-default-couple', NULL, NULL, 'paired', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE EXISTS (
    SELECT 1 FROM `AuthConfig`
    UNION ALL SELECT 1 FROM `DeviceSession`
    UNION ALL SELECT 1 FROM `CountdownEvent`
    UNION ALL SELECT 1 FROM `PeriodRecord`
    UNION ALL SELECT 1 FROM `PeriodSettings`
    UNION ALL SELECT 1 FROM `PeriodDailyLog`
    UNION ALL SELECT 1 FROM `CoupleCheckIn`
    UNION ALL SELECT 1 FROM `RelationshipNotificationCopy`
    UNION ALL SELECT 1 FROM `WishItem`
    UNION ALL SELECT 1 FROM `GachaEgg`
    UNION ALL SELECT 1 FROM `GachaDraw`
    UNION ALL SELECT 1 FROM `GachaDailyState`
    UNION ALL SELECT 1 FROM `TimelineNode`
    UNION ALL SELECT 1 FROM `ChatMessage`
    UNION ALL SELECT 1 FROM `ChatMessageFavorite`
    UNION ALL SELECT 1 FROM `ChatSticker`
    UNION ALL SELECT 1 FROM `ChatReadState`
    UNION ALL SELECT 1 FROM `AiChatMessage`
    UNION ALL SELECT 1 FROM `AiMemory`
    UNION ALL SELECT 1 FROM `MemoryReport`
    UNION ALL SELECT 1 FROM `VanishingTicTacToeGame`
    UNION ALL SELECT 1 FROM `DrawGuessRound`
    UNION ALL SELECT 1 FROM `DrawGuessAttempt`
    UNION ALL SELECT 1 FROM `TruthOrDareRound`
    UNION ALL SELECT 1 FROM `TruthOrDareQuestion`
    UNION ALL SELECT 1 FROM `CouplePet`
    UNION ALL SELECT 1 FROM `PetActivity`
    UNION ALL SELECT 1 FROM `PetLetter`
    UNION ALL SELECT 1 FROM `PetOwnedItem`
    UNION ALL SELECT 1 FROM `PetRoomPlacement`
    UNION ALL SELECT 1 FROM `PetFacility`
    LIMIT 1
)
ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP(3);

CREATE TABLE `ApiRateLimitBucket` (
    `key` VARCHAR(96) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `windowStartedAt` DATETIME(3) NOT NULL,
    `blockedUntil` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApiRateLimitBucket_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StorageReservation` (
    `id` VARCHAR(64) NOT NULL,
    `coupleId` VARCHAR(64) NOT NULL,
    `reservedBytes` BIGINT UNSIGNED NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StorageReservation_coupleId_expiresAt_idx`(`coupleId`, `expiresAt`),
    INDEX `StorageReservation_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `StorageReservation_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MediaDeletionJob` (
    `id` VARCHAR(64) NOT NULL,
    `coupleId` VARCHAR(64) NOT NULL,
    `filesJson` JSON NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MediaDeletionJob_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WebSocketConnectionLease` (
    `id` VARCHAR(64) NOT NULL,
    `sessionId` VARCHAR(64) NOT NULL,
    `coupleId` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebSocketConnectionLease_sessionId_expiresAt_idx`(`sessionId`, `expiresAt`),
    INDEX `WebSocketConnectionLease_coupleId_expiresAt_idx`(`coupleId`, `expiresAt`),
    INDEX `WebSocketConnectionLease_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `WebSocketConnectionLease_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `DeviceSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `WebSocketConnectionLease_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChatMessageFavorite` DROP FOREIGN KEY `ChatMessageFavorite_messageId_fkey`;
ALTER TABLE `DrawGuessAttempt` DROP FOREIGN KEY `DrawGuessAttempt_roundId_fkey`;
ALTER TABLE `TruthOrDareQuestion` DROP FOREIGN KEY `TruthOrDareQuestion_roundId_fkey`;
ALTER TABLE `PetActivity` DROP FOREIGN KEY `PetActivity_petId_fkey`;
ALTER TABLE `PetLetter` DROP FOREIGN KEY `PetLetter_petId_fkey`;
ALTER TABLE `PetOwnedItem` DROP FOREIGN KEY `PetOwnedItem_petId_fkey`;
ALTER TABLE `PetRoomPlacement` DROP FOREIGN KEY `PetRoomPlacement_petId_fkey`;
ALTER TABLE `PetFacility` DROP FOREIGN KEY `PetFacility_petId_fkey`;

ALTER TABLE `CountdownEvent` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `CountdownEvent_ownerRole_isFixed_idx` ON `CountdownEvent`;
DROP INDEX `CountdownEvent_isPinned_idx` ON `CountdownEvent`;
DROP INDEX `CountdownEvent_startDate_idx` ON `CountdownEvent`;
CREATE INDEX `CountdownEvent_coupleId_ownerRole_isFixed_idx` ON `CountdownEvent`(`coupleId`, `ownerRole`, `isFixed`);
CREATE INDEX `CountdownEvent_coupleId_isPinned_idx` ON `CountdownEvent`(`coupleId`, `isPinned`);
CREATE INDEX `CountdownEvent_coupleId_startDate_idx` ON `CountdownEvent`(`coupleId`, `startDate`);

ALTER TABLE `PeriodRecord` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `PeriodRecord_startDate_idx` ON `PeriodRecord`;
CREATE INDEX `PeriodRecord_coupleId_startDate_idx` ON `PeriodRecord`(`coupleId`, `startDate`);

ALTER TABLE `PeriodSettings` DROP PRIMARY KEY;
ALTER TABLE `PeriodSettings` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple' FIRST;
ALTER TABLE `PeriodSettings` DROP COLUMN `id`;
ALTER TABLE `PeriodSettings` ADD PRIMARY KEY (`coupleId`);

ALTER TABLE `PeriodDailyLog` DROP PRIMARY KEY;
ALTER TABLE `PeriodDailyLog` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple' FIRST;
ALTER TABLE `PeriodDailyLog` ADD PRIMARY KEY (`coupleId`, `date`);
CREATE INDEX `PeriodDailyLog_coupleId_updatedAt_idx` ON `PeriodDailyLog`(`coupleId`, `updatedAt`);

ALTER TABLE `CoupleCheckIn` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `CoupleCheckIn_date_role_key` ON `CoupleCheckIn`;
DROP INDEX `CoupleCheckIn_date_idx` ON `CoupleCheckIn`;
DROP INDEX `CoupleCheckIn_role_idx` ON `CoupleCheckIn`;
CREATE UNIQUE INDEX `CoupleCheckIn_coupleId_date_role_key` ON `CoupleCheckIn`(`coupleId`, `date`, `role`);
CREATE INDEX `CoupleCheckIn_coupleId_date_idx` ON `CoupleCheckIn`(`coupleId`, `date`);
CREATE INDEX `CoupleCheckIn_coupleId_role_idx` ON `CoupleCheckIn`(`coupleId`, `role`);

ALTER TABLE `RelationshipNotificationCopy` DROP PRIMARY KEY;
ALTER TABLE `RelationshipNotificationCopy` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple' FIRST;
ALTER TABLE `RelationshipNotificationCopy` ADD PRIMARY KEY (`coupleId`, `targetRole`);
DROP INDEX `RelationshipNotificationCopy_authorRole_idx` ON `RelationshipNotificationCopy`;
DROP INDEX `RelationshipNotificationCopy_updatedAt_idx` ON `RelationshipNotificationCopy`;
CREATE INDEX `RelationshipNotificationCopy_coupleId_authorRole_idx` ON `RelationshipNotificationCopy`(`coupleId`, `authorRole`);
CREATE INDEX `RelationshipNotificationCopy_coupleId_updatedAt_idx` ON `RelationshipNotificationCopy`(`coupleId`, `updatedAt`);

ALTER TABLE `WishItem` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `WishItem_ownerRole_idx` ON `WishItem`;
DROP INDEX `WishItem_status_idx` ON `WishItem`;
DROP INDEX `WishItem_priority_idx` ON `WishItem`;
DROP INDEX `WishItem_targetDate_idx` ON `WishItem`;
DROP INDEX `WishItem_updatedAt_idx` ON `WishItem`;
CREATE INDEX `WishItem_coupleId_ownerRole_idx` ON `WishItem`(`coupleId`, `ownerRole`);
CREATE INDEX `WishItem_coupleId_status_idx` ON `WishItem`(`coupleId`, `status`);
CREATE INDEX `WishItem_coupleId_priority_idx` ON `WishItem`(`coupleId`, `priority`);
CREATE INDEX `WishItem_coupleId_targetDate_idx` ON `WishItem`(`coupleId`, `targetDate`);
CREATE INDEX `WishItem_coupleId_updatedAt_idx` ON `WishItem`(`coupleId`, `updatedAt`);

ALTER TABLE `GachaEgg` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `GachaEgg_targetRole_status_createdAt_idx` ON `GachaEgg`;
DROP INDEX `GachaEgg_creatorRole_status_createdAt_idx` ON `GachaEgg`;
DROP INDEX `GachaEgg_expiresAt_idx` ON `GachaEgg`;
CREATE INDEX `GachaEgg_coupleId_targetRole_status_createdAt_idx` ON `GachaEgg`(`coupleId`, `targetRole`, `status`, `createdAt`);
CREATE INDEX `GachaEgg_coupleId_creatorRole_status_createdAt_idx` ON `GachaEgg`(`coupleId`, `creatorRole`, `status`, `createdAt`);
CREATE INDEX `GachaEgg_coupleId_expiresAt_idx` ON `GachaEgg`(`coupleId`, `expiresAt`);

ALTER TABLE `GachaDraw` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `GachaDraw_drawnBy_createdAt_idx` ON `GachaDraw`;
DROP INDEX `GachaDraw_drawnBy_pool_createdAt_idx` ON `GachaDraw`;
DROP INDEX `GachaDraw_creatorRole_createdAt_idx` ON `GachaDraw`;
DROP INDEX `GachaDraw_status_createdAt_idx` ON `GachaDraw`;
CREATE INDEX `GachaDraw_coupleId_drawnBy_createdAt_idx` ON `GachaDraw`(`coupleId`, `drawnBy`, `createdAt`);
CREATE INDEX `GachaDraw_coupleId_drawnBy_pool_createdAt_idx` ON `GachaDraw`(`coupleId`, `drawnBy`, `pool`, `createdAt`);
CREATE INDEX `GachaDraw_coupleId_creatorRole_createdAt_idx` ON `GachaDraw`(`coupleId`, `creatorRole`, `createdAt`);
CREATE INDEX `GachaDraw_coupleId_status_createdAt_idx` ON `GachaDraw`(`coupleId`, `status`, `createdAt`);

ALTER TABLE `GachaDailyState` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `GachaDailyState_date_role_key` ON `GachaDailyState`;
DROP INDEX `GachaDailyState_date_idx` ON `GachaDailyState`;
DROP INDEX `GachaDailyState_role_idx` ON `GachaDailyState`;
CREATE UNIQUE INDEX `GachaDailyState_coupleId_date_role_key` ON `GachaDailyState`(`coupleId`, `date`, `role`);
CREATE INDEX `GachaDailyState_coupleId_date_idx` ON `GachaDailyState`(`coupleId`, `date`);
CREATE INDEX `GachaDailyState_coupleId_role_idx` ON `GachaDailyState`(`coupleId`, `role`);

ALTER TABLE `TimelineNode` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `TimelineNode_eventDate_idx` ON `TimelineNode`;
DROP INDEX `TimelineNode_createdBy_idx` ON `TimelineNode`;
DROP INDEX `TimelineNode_isHighlight_idx` ON `TimelineNode`;
DROP INDEX `TimelineNode_updatedAt_idx` ON `TimelineNode`;
CREATE INDEX `TimelineNode_coupleId_eventDate_idx` ON `TimelineNode`(`coupleId`, `eventDate`);
CREATE INDEX `TimelineNode_coupleId_createdBy_idx` ON `TimelineNode`(`coupleId`, `createdBy`);
CREATE INDEX `TimelineNode_coupleId_isHighlight_idx` ON `TimelineNode`(`coupleId`, `isHighlight`);
CREATE INDEX `TimelineNode_coupleId_updatedAt_idx` ON `TimelineNode`(`coupleId`, `updatedAt`);

ALTER TABLE `ChatMessage` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `ChatMessage_createdAt_idx` ON `ChatMessage`;
DROP INDEX `ChatMessage_recalledAt_idx` ON `ChatMessage`;
DROP INDEX `ChatMessage_replyToMessageId_idx` ON `ChatMessage`;
DROP INDEX `ChatMessage_isFavorite_createdAt_idx` ON `ChatMessage`;
DROP INDEX `ChatMessage_stickerId_idx` ON `ChatMessage`;
CREATE INDEX `ChatMessage_coupleId_createdAt_idx` ON `ChatMessage`(`coupleId`, `createdAt`);
CREATE INDEX `ChatMessage_coupleId_recalledAt_idx` ON `ChatMessage`(`coupleId`, `recalledAt`);
CREATE INDEX `ChatMessage_coupleId_replyToMessageId_idx` ON `ChatMessage`(`coupleId`, `replyToMessageId`);
CREATE INDEX `ChatMessage_coupleId_isFavorite_createdAt_idx` ON `ChatMessage`(`coupleId`, `isFavorite`, `createdAt`);
CREATE INDEX `ChatMessage_coupleId_stickerId_idx` ON `ChatMessage`(`coupleId`, `stickerId`);

ALTER TABLE `ChatMessageFavorite` DROP PRIMARY KEY;
ALTER TABLE `ChatMessageFavorite` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple' FIRST;
ALTER TABLE `ChatMessageFavorite` ADD PRIMARY KEY (`coupleId`, `messageId`, `ownerRole`);
DROP INDEX `ChatMessageFavorite_ownerRole_createdAt_idx` ON `ChatMessageFavorite`;
CREATE INDEX `ChatMessageFavorite_coupleId_ownerRole_createdAt_idx` ON `ChatMessageFavorite`(`coupleId`, `ownerRole`, `createdAt`);

ALTER TABLE `ChatSticker` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `ChatSticker_ownerRole_fileHash_key` ON `ChatSticker`;
DROP INDEX `ChatSticker_ownerRole_isDeleted_sortOrder_idx` ON `ChatSticker`;
CREATE UNIQUE INDEX `ChatSticker_coupleId_ownerRole_fileHash_key` ON `ChatSticker`(`coupleId`, `ownerRole`, `fileHash`);
CREATE INDEX `ChatSticker_coupleId_ownerRole_isDeleted_sortOrder_idx` ON `ChatSticker`(`coupleId`, `ownerRole`, `isDeleted`, `sortOrder`);

ALTER TABLE `ChatReadState` DROP PRIMARY KEY;
ALTER TABLE `ChatReadState` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple' FIRST;
ALTER TABLE `ChatReadState` ADD PRIMARY KEY (`coupleId`, `role`);

ALTER TABLE `AiChatMessage` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `AiChatMessage_conversationRole_createdAt_idx` ON `AiChatMessage`;
DROP INDEX `AiChatMessage_conversationRole_sortOrder_idx` ON `AiChatMessage`;
CREATE INDEX `AiChatMessage_coupleId_conversationRole_createdAt_idx` ON `AiChatMessage`(`coupleId`, `conversationRole`, `createdAt`);
CREATE INDEX `AiChatMessage_coupleId_conversationRole_sortOrder_idx` ON `AiChatMessage`(`coupleId`, `conversationRole`, `sortOrder`);

ALTER TABLE `AiMemory` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `AiMemory_subjectRole_updatedAt_idx` ON `AiMemory`;
CREATE INDEX `AiMemory_coupleId_subjectRole_updatedAt_idx` ON `AiMemory`(`coupleId`, `subjectRole`, `updatedAt`);

ALTER TABLE `MemoryReport` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `MemoryReport_reportType_periodKey_viewerRole_key` ON `MemoryReport`;
DROP INDEX `MemoryReport_viewerRole_generatedAt_idx` ON `MemoryReport`;
DROP INDEX `MemoryReport_reportType_periodKey_idx` ON `MemoryReport`;
CREATE UNIQUE INDEX `MemoryReport_coupleId_reportType_periodKey_viewerRole_key` ON `MemoryReport`(`coupleId`, `reportType`, `periodKey`, `viewerRole`);
CREATE INDEX `MemoryReport_coupleId_viewerRole_generatedAt_idx` ON `MemoryReport`(`coupleId`, `viewerRole`, `generatedAt`);
CREATE INDEX `MemoryReport_coupleId_reportType_periodKey_idx` ON `MemoryReport`(`coupleId`, `reportType`, `periodKey`);

ALTER TABLE `DeviceSession` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `DeviceSession_partnerRole_revokedAt_idx` ON `DeviceSession`;
CREATE INDEX `DeviceSession_coupleId_revokedAt_idx` ON `DeviceSession`(`coupleId`, `revokedAt`);
CREATE INDEX `DeviceSession_coupleId_partnerRole_revokedAt_idx` ON `DeviceSession`(`coupleId`, `partnerRole`, `revokedAt`);

ALTER TABLE `VanishingTicTacToeGame` DROP PRIMARY KEY;
ALTER TABLE `VanishingTicTacToeGame` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple' FIRST;
UPDATE `VanishingTicTacToeGame` SET `coupleId` = 'legacy-default-couple' WHERE `coupleId` IS NULL OR `coupleId` = '';
ALTER TABLE `VanishingTicTacToeGame` DROP COLUMN `id`;
ALTER TABLE `VanishingTicTacToeGame` ADD PRIMARY KEY (`coupleId`);

ALTER TABLE `DrawGuessRound` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `DrawGuessRound_roundNumber_key` ON `DrawGuessRound`;
CREATE UNIQUE INDEX `DrawGuessRound_coupleId_roundNumber_key` ON `DrawGuessRound`(`coupleId`, `roundNumber`);
DROP INDEX `DrawGuessRound_status_updatedAt_idx` ON `DrawGuessRound`;
DROP INDEX `DrawGuessRound_drawerRole_createdAt_idx` ON `DrawGuessRound`;
DROP INDEX `DrawGuessRound_guesserRole_createdAt_idx` ON `DrawGuessRound`;
DROP INDEX `DrawGuessRound_completedAt_idx` ON `DrawGuessRound`;
CREATE INDEX `DrawGuessRound_coupleId_status_updatedAt_idx` ON `DrawGuessRound`(`coupleId`, `status`, `updatedAt`);
CREATE INDEX `DrawGuessRound_coupleId_drawerRole_createdAt_idx` ON `DrawGuessRound`(`coupleId`, `drawerRole`, `createdAt`);
CREATE INDEX `DrawGuessRound_coupleId_guesserRole_createdAt_idx` ON `DrawGuessRound`(`coupleId`, `guesserRole`, `createdAt`);
CREATE INDEX `DrawGuessRound_coupleId_completedAt_idx` ON `DrawGuessRound`(`coupleId`, `completedAt`);

ALTER TABLE `DrawGuessAttempt` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `DrawGuessAttempt_roundId_createdAt_idx` ON `DrawGuessAttempt`;
DROP INDEX `DrawGuessAttempt_role_createdAt_idx` ON `DrawGuessAttempt`;
CREATE INDEX `DrawGuessAttempt_coupleId_roundId_createdAt_idx` ON `DrawGuessAttempt`(`coupleId`, `roundId`, `createdAt`);
CREATE INDEX `DrawGuessAttempt_coupleId_role_createdAt_idx` ON `DrawGuessAttempt`(`coupleId`, `role`, `createdAt`);

ALTER TABLE `TruthOrDareRound` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `TruthOrDareRound_roundNumber_key` ON `TruthOrDareRound`;
CREATE UNIQUE INDEX `TruthOrDareRound_coupleId_roundNumber_key` ON `TruthOrDareRound`(`coupleId`, `roundNumber`);
DROP INDEX `TruthOrDareRound_status_updatedAt_idx` ON `TruthOrDareRound`;
DROP INDEX `TruthOrDareRound_performerRole_createdAt_idx` ON `TruthOrDareRound`;
DROP INDEX `TruthOrDareRound_pickerRole_createdAt_idx` ON `TruthOrDareRound`;
DROP INDEX `TruthOrDareRound_completedAt_idx` ON `TruthOrDareRound`;
CREATE INDEX `TruthOrDareRound_coupleId_status_updatedAt_idx` ON `TruthOrDareRound`(`coupleId`, `status`, `updatedAt`);
CREATE INDEX `TruthOrDareRound_coupleId_performerRole_createdAt_idx` ON `TruthOrDareRound`(`coupleId`, `performerRole`, `createdAt`);
CREATE INDEX `TruthOrDareRound_coupleId_pickerRole_createdAt_idx` ON `TruthOrDareRound`(`coupleId`, `pickerRole`, `createdAt`);
CREATE INDEX `TruthOrDareRound_coupleId_completedAt_idx` ON `TruthOrDareRound`(`coupleId`, `completedAt`);

ALTER TABLE `TruthOrDareQuestion` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `TruthOrDareQuestion_normalizedKey_key` ON `TruthOrDareQuestion`;
DROP INDEX `TruthOrDareQuestion_roundId_batchNumber_createdAt_idx` ON `TruthOrDareQuestion`;
DROP INDEX `TruthOrDareQuestion_generatedByRole_kind_createdAt_idx` ON `TruthOrDareQuestion`;
DROP INDEX `TruthOrDareQuestion_targetRole_kind_createdAt_idx` ON `TruthOrDareQuestion`;
CREATE UNIQUE INDEX `TruthOrDareQuestion_coupleId_normalizedKey_key` ON `TruthOrDareQuestion`(`coupleId`, `normalizedKey`);
CREATE INDEX `TruthOrDareQuestion_coupleId_roundId_batchNumber_createdAt_idx` ON `TruthOrDareQuestion`(`coupleId`, `roundId`, `batchNumber`, `createdAt`);
CREATE INDEX `TruthOrDareQuestion_coupleId_generatedByRole_kind_createdAt_idx` ON `TruthOrDareQuestion`(`coupleId`, `generatedByRole`, `kind`, `createdAt`);
CREATE INDEX `TruthOrDareQuestion_coupleId_targetRole_kind_createdAt_idx` ON `TruthOrDareQuestion`(`coupleId`, `targetRole`, `kind`, `createdAt`);

ALTER TABLE `CouplePet` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
ALTER TABLE `CouplePet` MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT;
CREATE UNIQUE INDEX `CouplePet_coupleId_key` ON `CouplePet`(`coupleId`);

ALTER TABLE `PetActivity` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `PetActivity_petId_createdAt_idx` ON `PetActivity`;
DROP INDEX `PetActivity_role_createdAt_idx` ON `PetActivity`;
CREATE INDEX `PetActivity_coupleId_petId_createdAt_idx` ON `PetActivity`(`coupleId`, `petId`, `createdAt`);
CREATE INDEX `PetActivity_coupleId_role_createdAt_idx` ON `PetActivity`(`coupleId`, `role`, `createdAt`);

ALTER TABLE `PetLetter` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `PetLetter_recipientRole_status_createdAt_idx` ON `PetLetter`;
DROP INDEX `PetLetter_senderRole_createdAt_idx` ON `PetLetter`;
DROP INDEX `PetLetter_petId_createdAt_idx` ON `PetLetter`;
CREATE INDEX `PetLetter_coupleId_recipientRole_status_createdAt_idx` ON `PetLetter`(`coupleId`, `recipientRole`, `status`, `createdAt`);
CREATE INDEX `PetLetter_coupleId_senderRole_createdAt_idx` ON `PetLetter`(`coupleId`, `senderRole`, `createdAt`);
CREATE INDEX `PetLetter_coupleId_petId_createdAt_idx` ON `PetLetter`(`coupleId`, `petId`, `createdAt`);

ALTER TABLE `PetOwnedItem` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `PetOwnedItem_petId_itemKey_key` ON `PetOwnedItem`;
DROP INDEX `PetOwnedItem_petId_acquiredAt_idx` ON `PetOwnedItem`;
CREATE UNIQUE INDEX `PetOwnedItem_coupleId_petId_itemKey_key` ON `PetOwnedItem`(`coupleId`, `petId`, `itemKey`);
CREATE INDEX `PetOwnedItem_coupleId_petId_acquiredAt_idx` ON `PetOwnedItem`(`coupleId`, `petId`, `acquiredAt`);

ALTER TABLE `PetRoomPlacement` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `PetRoomPlacement_petId_scene_slotKey_key` ON `PetRoomPlacement`;
DROP INDEX `PetRoomPlacement_petId_updatedAt_idx` ON `PetRoomPlacement`;
CREATE UNIQUE INDEX `PetRoomPlacement_coupleId_petId_scene_slotKey_key` ON `PetRoomPlacement`(`coupleId`, `petId`, `scene`, `slotKey`);
CREATE INDEX `PetRoomPlacement_coupleId_petId_updatedAt_idx` ON `PetRoomPlacement`(`coupleId`, `petId`, `updatedAt`);

ALTER TABLE `PetFacility` ADD COLUMN `coupleId` VARCHAR(64) NOT NULL DEFAULT 'legacy-default-couple';
DROP INDEX `PetFacility_petId_facilityKey_key` ON `PetFacility`;
CREATE UNIQUE INDEX `PetFacility_coupleId_petId_facilityKey_key` ON `PetFacility`(`coupleId`, `petId`, `facilityKey`);

-- The temporary defaults above make the migration safe for populated legacy
-- tables.  Remove them after every existing row has been backfilled so future
-- writes must always provide an authenticated tenant id.
ALTER TABLE `CountdownEvent` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PeriodRecord` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PeriodSettings` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PeriodDailyLog` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `CoupleCheckIn` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `RelationshipNotificationCopy` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `WishItem` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `GachaEgg` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `GachaDraw` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `GachaDailyState` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `TimelineNode` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `ChatMessage` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `ChatMessageFavorite` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `ChatSticker` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `ChatReadState` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `AiChatMessage` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `AiMemory` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `MemoryReport` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `DeviceSession` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `VanishingTicTacToeGame` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `DrawGuessRound` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `DrawGuessAttempt` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `TruthOrDareRound` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `TruthOrDareQuestion` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `CouplePet` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PetActivity` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PetLetter` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PetOwnedItem` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PetRoomPlacement` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;
ALTER TABLE `PetFacility` MODIFY COLUMN `coupleId` VARCHAR(64) NOT NULL;

-- Restore the legacy relationships that had to be removed before changing
-- their supporting primary keys/indexes.
ALTER TABLE `ChatMessageFavorite` ADD CONSTRAINT `ChatMessageFavorite_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ChatMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DrawGuessAttempt` ADD CONSTRAINT `DrawGuessAttempt_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `DrawGuessRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TruthOrDareQuestion` ADD CONSTRAINT `TruthOrDareQuestion_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `TruthOrDareRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetActivity` ADD CONSTRAINT `PetActivity_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetLetter` ADD CONSTRAINT `PetLetter_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetOwnedItem` ADD CONSTRAINT `PetOwnedItem_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetRoomPlacement` ADD CONSTRAINT `PetRoomPlacement_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetFacility` ADD CONSTRAINT `PetFacility_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant ownership is enforced in the database as well as in Prisma.
ALTER TABLE `CountdownEvent` ADD CONSTRAINT `CountdownEvent_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PeriodRecord` ADD CONSTRAINT `PeriodRecord_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PeriodSettings` ADD CONSTRAINT `PeriodSettings_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PeriodDailyLog` ADD CONSTRAINT `PeriodDailyLog_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CoupleCheckIn` ADD CONSTRAINT `CoupleCheckIn_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RelationshipNotificationCopy` ADD CONSTRAINT `RelationshipNotificationCopy_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WishItem` ADD CONSTRAINT `WishItem_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GachaEgg` ADD CONSTRAINT `GachaEgg_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GachaDraw` ADD CONSTRAINT `GachaDraw_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GachaDailyState` ADD CONSTRAINT `GachaDailyState_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TimelineNode` ADD CONSTRAINT `TimelineNode_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChatMessageFavorite` ADD CONSTRAINT `ChatMessageFavorite_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChatSticker` ADD CONSTRAINT `ChatSticker_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChatReadState` ADD CONSTRAINT `ChatReadState_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiChatMessage` ADD CONSTRAINT `AiChatMessage_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiMemory` ADD CONSTRAINT `AiMemory_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MemoryReport` ADD CONSTRAINT `MemoryReport_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DeviceSession` ADD CONSTRAINT `DeviceSession_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `VanishingTicTacToeGame` ADD CONSTRAINT `VanishingTicTacToeGame_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DrawGuessRound` ADD CONSTRAINT `DrawGuessRound_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DrawGuessAttempt` ADD CONSTRAINT `DrawGuessAttempt_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TruthOrDareRound` ADD CONSTRAINT `TruthOrDareRound_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TruthOrDareQuestion` ADD CONSTRAINT `TruthOrDareQuestion_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CouplePet` ADD CONSTRAINT `CouplePet_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetActivity` ADD CONSTRAINT `PetActivity_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetLetter` ADD CONSTRAINT `PetLetter_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetOwnedItem` ADD CONSTRAINT `PetOwnedItem_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetRoomPlacement` ADD CONSTRAINT `PetRoomPlacement_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PetFacility` ADD CONSTRAINT `PetFacility_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
