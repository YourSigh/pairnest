-- CreateTable
CREATE TABLE `CountdownEvent` (
    `id` VARCHAR(191) NOT NULL,
    `ownerRole` VARCHAR(16) NULL,
    `title` VARCHAR(128) NOT NULL,
    `startDate` VARCHAR(10) NOT NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isFixed` BOOLEAN NOT NULL DEFAULT false,
    `category` VARCHAR(64) NULL,
    `calendarType` VARCHAR(16) NOT NULL DEFAULT 'solar',
    `lunarYear` INTEGER NULL,
    `lunarMonth` INTEGER NULL,
    `lunarDay` INTEGER NULL,
    `lunarIsLeapMonth` BOOLEAN NULL,
    `repeatMode` VARCHAR(16) NOT NULL DEFAULT 'none',
    `pastDisplayMode` VARCHAR(16) NOT NULL DEFAULT 'days',
    `reminderOffsetDays` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CountdownEvent_ownerRole_isFixed_idx`(`ownerRole`, `isFixed`),
    INDEX `CountdownEvent_isPinned_idx`(`isPinned`),
    INDEX `CountdownEvent_startDate_idx`(`startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PeriodRecord` (
    `id` VARCHAR(191) NOT NULL,
    `startDate` VARCHAR(10) NOT NULL,
    `endDate` VARCHAR(10) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PeriodRecord_startDate_idx`(`startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PeriodSettings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `cycleLength` INTEGER NOT NULL DEFAULT 28,
    `periodDuration` INTEGER NOT NULL DEFAULT 5,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PeriodDailyLog` (
    `date` VARCHAR(10) NOT NULL,
    `flow` VARCHAR(16) NULL,
    `pain` INTEGER NULL,
    `symptoms` VARCHAR(1024) NOT NULL DEFAULT '[]',
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoupleCheckIn` (
    `id` VARCHAR(80) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `mood` VARCHAR(32) NOT NULL,
    `message` TEXT NOT NULL,
    `gachaReturnUsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CoupleCheckIn_date_idx`(`date`),
    INDEX `CoupleCheckIn_role_idx`(`role`),
    UNIQUE INDEX `CoupleCheckIn_date_role_key`(`date`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RelationshipNotificationCopy` (
    `targetRole` VARCHAR(16) NOT NULL,
    `authorRole` VARCHAR(16) NOT NULL,
    `content` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RelationshipNotificationCopy_authorRole_idx`(`authorRole`),
    INDEX `RelationshipNotificationCopy_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`targetRole`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WishItem` (
    `id` VARCHAR(80) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `ownerRole` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `priority` VARCHAR(16) NOT NULL DEFAULT 'normal',
    `category` VARCHAR(32) NOT NULL DEFAULT '小心愿',
    `targetDate` VARCHAR(10) NULL,
    `reservedBy` VARCHAR(16) NULL,
    `fulfilledAt` DATETIME(3) NULL,
    `fulfilledBy` VARCHAR(16) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WishItem_ownerRole_idx`(`ownerRole`),
    INDEX `WishItem_status_idx`(`status`),
    INDEX `WishItem_priority_idx`(`priority`),
    INDEX `WishItem_targetDate_idx`(`targetDate`),
    INDEX `WishItem_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GachaEgg` (
    `id` VARCHAR(80) NOT NULL,
    `eggType` VARCHAR(16) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `creatorRole` VARCHAR(16) NOT NULL,
    `targetRole` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `expiresAt` DATETIME(3) NULL,
    `drawnAt` DATETIME(3) NULL,
    `respondedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GachaEgg_targetRole_status_createdAt_idx`(`targetRole`, `status`, `createdAt`),
    INDEX `GachaEgg_creatorRole_status_createdAt_idx`(`creatorRole`, `status`, `createdAt`),
    INDEX `GachaEgg_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GachaDraw` (
    `id` VARCHAR(80) NOT NULL,
    `pool` VARCHAR(16) NOT NULL DEFAULT 'limited',
    `source` VARCHAR(16) NOT NULL,
    `eggType` VARCHAR(16) NOT NULL,
    `templateId` VARCHAR(80) NULL,
    `customEggId` VARCHAR(80) NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `starterTask` TEXT NOT NULL,
    `partnerTask` TEXT NOT NULL,
    `duration` VARCHAR(32) NOT NULL,
    `scene` VARCHAR(32) NOT NULL,
    `color` VARCHAR(16) NOT NULL,
    `softColor` VARCHAR(16) NOT NULL,
    `icon` VARCHAR(64) NOT NULL,
    `drawnBy` VARCHAR(16) NOT NULL,
    `creatorRole` VARCHAR(16) NULL,
    `targetRole` VARCHAR(16) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'drawn',
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GachaDraw_customEggId_key`(`customEggId`),
    INDEX `GachaDraw_drawnBy_createdAt_idx`(`drawnBy`, `createdAt`),
    INDEX `GachaDraw_drawnBy_pool_createdAt_idx`(`drawnBy`, `pool`, `createdAt`),
    INDEX `GachaDraw_creatorRole_createdAt_idx`(`creatorRole`, `createdAt`),
    INDEX `GachaDraw_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GachaDailyState` (
    `id` VARCHAR(80) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `returnUsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GachaDailyState_date_idx`(`date`),
    INDEX `GachaDailyState_role_idx`(`role`),
    UNIQUE INDEX `GachaDailyState_date_role_key`(`date`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimelineNode` (
    `id` VARCHAR(80) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `eventDate` VARCHAR(10) NOT NULL,
    `eventTime` VARCHAR(5) NULL,
    `location` VARCHAR(80) NULL,
    `mood` VARCHAR(32) NOT NULL DEFAULT 'sweet',
    `category` VARCHAR(32) NOT NULL DEFAULT '日常',
    `createdBy` VARCHAR(16) NOT NULL,
    `isHighlight` BOOLEAN NOT NULL DEFAULT false,
    `imageFileName` VARCHAR(255) NULL,
    `imageMimeType` VARCHAR(64) NULL,
    `imageSize` INTEGER NULL,
    `imageWidth` INTEGER NULL,
    `imageHeight` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TimelineNode_eventDate_idx`(`eventDate`),
    INDEX `TimelineNode_createdBy_idx`(`createdBy`),
    INDEX `TimelineNode_isHighlight_idx`(`isHighlight`),
    INDEX `TimelineNode_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `sender` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `messageType` VARCHAR(16) NOT NULL DEFAULT 'text',
    `audioFileName` VARCHAR(255) NULL,
    `audioMimeType` VARCHAR(64) NULL,
    `audioSize` INTEGER NULL,
    `audioDurationMs` INTEGER NULL,
    `imageFileName` VARCHAR(255) NULL,
    `imageMimeType` VARCHAR(64) NULL,
    `imageSize` INTEGER NULL,
    `imageWidth` INTEGER NULL,
    `imageHeight` INTEGER NULL,
    `imageThumbFileName` VARCHAR(255) NULL,
    `imageThumbMimeType` VARCHAR(64) NULL,
    `imageThumbSize` INTEGER NULL,
    `imageThumbWidth` INTEGER NULL,
    `imageThumbHeight` INTEGER NULL,
    `imageOriginalFileName` VARCHAR(255) NULL,
    `imageOriginalMimeType` VARCHAR(64) NULL,
    `imageOriginalSize` INTEGER NULL,
    `imageOriginalWidth` INTEGER NULL,
    `imageOriginalHeight` INTEGER NULL,
    `videoFileName` VARCHAR(255) NULL,
    `videoMimeType` VARCHAR(64) NULL,
    `videoSize` INTEGER NULL,
    `videoDurationMs` INTEGER NULL,
    `videoWidth` INTEGER NULL,
    `videoHeight` INTEGER NULL,
    `videoThumbFileName` VARCHAR(255) NULL,
    `videoThumbMimeType` VARCHAR(64) NULL,
    `videoThumbSize` INTEGER NULL,
    `videoThumbWidth` INTEGER NULL,
    `videoThumbHeight` INTEGER NULL,
    `stickerId` VARCHAR(80) NULL,
    `stickerFileName` VARCHAR(255) NULL,
    `stickerMimeType` VARCHAR(64) NULL,
    `stickerSize` INTEGER NULL,
    `stickerWidth` INTEGER NULL,
    `stickerHeight` INTEGER NULL,
    `transcript` TEXT NULL,
    `transcriptionStatus` VARCHAR(16) NULL,
    `replyToMessageId` VARCHAR(191) NULL,
    `recalledAt` DATETIME(3) NULL,
    `recalledBy` VARCHAR(16) NULL,
    `isFavorite` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatMessage_createdAt_idx`(`createdAt`),
    INDEX `ChatMessage_recalledAt_idx`(`recalledAt`),
    INDEX `ChatMessage_replyToMessageId_idx`(`replyToMessageId`),
    INDEX `ChatMessage_isFavorite_createdAt_idx`(`isFavorite`, `createdAt`),
    INDEX `ChatMessage_stickerId_idx`(`stickerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessageFavorite` (
    `messageId` VARCHAR(191) NOT NULL,
    `ownerRole` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatMessageFavorite_ownerRole_createdAt_idx`(`ownerRole`, `createdAt`),
    PRIMARY KEY (`messageId`, `ownerRole`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatSticker` (
    `id` VARCHAR(80) NOT NULL,
    `ownerRole` VARCHAR(16) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(64) NOT NULL,
    `fileHash` VARCHAR(64) NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatSticker_ownerRole_isDeleted_sortOrder_idx`(`ownerRole`, `isDeleted`, `sortOrder`),
    UNIQUE INDEX `ChatSticker_ownerRole_fileHash_key`(`ownerRole`, `fileHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatReadState` (
    `role` VARCHAR(16) NOT NULL,
    `lastReadMessageId` VARCHAR(64) NOT NULL,
    `lastReadAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiChatMessage` (
    `id` VARCHAR(64) NOT NULL,
    `conversationRole` VARCHAR(16) NOT NULL,
    `messageRole` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `sortOrder` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiChatMessage_conversationRole_createdAt_idx`(`conversationRole`, `createdAt`),
    INDEX `AiChatMessage_conversationRole_sortOrder_idx`(`conversationRole`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiMemory` (
    `id` VARCHAR(64) NOT NULL,
    `subjectRole` VARCHAR(16) NOT NULL,
    `sourceRole` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AiMemory_subjectRole_updatedAt_idx`(`subjectRole`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemoryReport` (
    `id` VARCHAR(96) NOT NULL,
    `reportType` VARCHAR(16) NOT NULL,
    `periodKey` VARCHAR(10) NOT NULL,
    `viewerRole` VARCHAR(16) NOT NULL,
    `payloadJson` LONGTEXT NOT NULL,
    `statsJson` LONGTEXT NOT NULL,
    `sourceVersion` VARCHAR(64) NOT NULL,
    `generatedByAi` BOOLEAN NOT NULL DEFAULT false,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MemoryReport_viewerRole_generatedAt_idx`(`viewerRole`, `generatedAt`),
    INDEX `MemoryReport_reportType_periodKey_idx`(`reportType`, `periodKey`),
    UNIQUE INDEX `MemoryReport_reportType_periodKey_viewerRole_key`(`reportType`, `periodKey`, `viewerRole`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `secretHash` VARCHAR(256) NOT NULL,
    `maxActivations` INTEGER NOT NULL DEFAULT 2,
    `activationCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthActivationAttempt` (
    `scope` VARCHAR(16) NOT NULL,
    `subjectHash` VARCHAR(64) NOT NULL,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `windowStartedAt` DATETIME(3) NOT NULL,
    `lastFailedAt` DATETIME(3) NOT NULL,
    `blockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuthActivationAttempt_blockedUntil_idx`(`blockedUntil`),
    INDEX `AuthActivationAttempt_lastFailedAt_idx`(`lastFailedAt`),
    PRIMARY KEY (`scope`, `subjectHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceSession` (
    `id` VARCHAR(64) NOT NULL,
    `deviceId` VARCHAR(128) NOT NULL,
    `partnerRole` ENUM('partnerA', 'partnerB') NOT NULL,
    `deviceSecretHash` VARCHAR(64) NOT NULL,
    `refreshTokenHash` VARCHAR(64) NOT NULL,
    `previousRefreshTokenHash` VARCHAR(64) NULL,
    `previousRefreshValidUntil` DATETIME(3) NULL,
    `deviceName` VARCHAR(128) NULL,
    `platform` VARCHAR(32) NULL,
    `osVersion` VARCHAR(64) NULL,
    `appVersion` VARCHAR(32) NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeviceSession_deviceId_key`(`deviceId`),
    UNIQUE INDEX `DeviceSession_refreshTokenHash_key`(`refreshTokenHash`),
    INDEX `DeviceSession_revokedAt_idx`(`revokedAt`),
    INDEX `DeviceSession_lastUsedAt_idx`(`lastUsedAt`),
    INDEX `DeviceSession_partnerRole_revokedAt_idx`(`partnerRole`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VanishingTicTacToeGame` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(16) NOT NULL DEFAULT 'waiting',
    `round` INTEGER NOT NULL DEFAULT 0,
    `femaleReady` BOOLEAN NOT NULL DEFAULT false,
    `maleReady` BOOLEAN NOT NULL DEFAULT false,
    `starterRole` VARCHAR(16) NULL,
    `currentTurn` VARCHAR(16) NULL,
    `winnerRole` VARCHAR(16) NULL,
    `boardJson` VARCHAR(2048) NOT NULL DEFAULT '[]',
    `femaleQueueJson` VARCHAR(128) NOT NULL DEFAULT '[]',
    `maleQueueJson` VARCHAR(128) NOT NULL DEFAULT '[]',
    `winningLineJson` VARCHAR(64) NOT NULL DEFAULT '[]',
    `moveNumber` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DrawGuessRound` (
    `id` VARCHAR(80) NOT NULL,
    `roundNumber` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'choosing',
    `drawerRole` VARCHAR(16) NOT NULL,
    `guesserRole` VARCHAR(16) NOT NULL,
    `category` VARCHAR(24) NOT NULL,
    `wordId` VARCHAR(64) NULL,
    `answer` VARCHAR(64) NULL,
    `hint` VARCHAR(160) NULL,
    `wordChoicesJson` VARCHAR(1024) NOT NULL DEFAULT '[]',
    `drawingJson` LONGTEXT NOT NULL,
    `strokeCount` INTEGER NOT NULL DEFAULT 0,
    `hintUsed` BOOLEAN NOT NULL DEFAULT false,
    `submittedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DrawGuessRound_roundNumber_key`(`roundNumber`),
    INDEX `DrawGuessRound_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `DrawGuessRound_drawerRole_createdAt_idx`(`drawerRole`, `createdAt`),
    INDEX `DrawGuessRound_guesserRole_createdAt_idx`(`guesserRole`, `createdAt`),
    INDEX `DrawGuessRound_completedAt_idx`(`completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DrawGuessAttempt` (
    `id` VARCHAR(80) NOT NULL,
    `roundId` VARCHAR(80) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` VARCHAR(64) NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DrawGuessAttempt_roundId_createdAt_idx`(`roundId`, `createdAt`),
    INDEX `DrawGuessAttempt_role_createdAt_idx`(`role`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TruthOrDareRound` (
    `id` VARCHAR(80) NOT NULL,
    `roundNumber` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'selecting',
    `kind` VARCHAR(16) NOT NULL,
    `performerRole` VARCHAR(16) NOT NULL,
    `pickerRole` VARCHAR(16) NOT NULL,
    `selectedQuestionId` VARCHAR(80) NULL,
    `replacementCount` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TruthOrDareRound_roundNumber_key`(`roundNumber`),
    INDEX `TruthOrDareRound_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `TruthOrDareRound_performerRole_createdAt_idx`(`performerRole`, `createdAt`),
    INDEX `TruthOrDareRound_pickerRole_createdAt_idx`(`pickerRole`, `createdAt`),
    INDEX `TruthOrDareRound_completedAt_idx`(`completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TruthOrDareQuestion` (
    `id` VARCHAR(80) NOT NULL,
    `roundId` VARCHAR(80) NOT NULL,
    `batchNumber` INTEGER NOT NULL DEFAULT 1,
    `kind` VARCHAR(16) NOT NULL,
    `content` VARCHAR(600) NOT NULL,
    `normalizedKey` VARCHAR(191) NOT NULL,
    `generatedByRole` VARCHAR(16) NOT NULL,
    `targetRole` VARCHAR(16) NOT NULL,
    `selectedAt` DATETIME(3) NULL,
    `discardedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TruthOrDareQuestion_normalizedKey_key`(`normalizedKey`),
    INDEX `TruthOrDareQuestion_roundId_batchNumber_createdAt_idx`(`roundId`, `batchNumber`, `createdAt`),
    INDEX `TruthOrDareQuestion_generatedByRole_kind_createdAt_idx`(`generatedByRole`, `kind`, `createdAt`),
    INDEX `TruthOrDareQuestion_targetRole_kind_createdAt_idx`(`targetRole`, `kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CouplePet` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(24) NOT NULL DEFAULT '小栖',
    `species` VARCHAR(24) NOT NULL DEFAULT 'samoyed',
    `level` INTEGER NOT NULL DEFAULT 1,
    `experience` INTEGER NOT NULL DEFAULT 0,
    `hunger` INTEGER NOT NULL DEFAULT 82,
    `happiness` INTEGER NOT NULL DEFAULT 88,
    `cleanliness` INTEGER NOT NULL DEFAULT 90,
    `energy` INTEGER NOT NULL DEFAULT 86,
    `affection` INTEGER NOT NULL DEFAULT 0,
    `coins` INTEGER NOT NULL DEFAULT 120,
    `careStreak` INTEGER NOT NULL DEFAULT 0,
    `lastCareDate` VARCHAR(10) NULL,
    `lastDailyClaimDate` VARCHAR(10) NULL,
    `unlockedJson` VARCHAR(2048) NOT NULL DEFAULT '[]',
    `equippedAccessory` VARCHAR(32) NULL,
    `questClaimDate` VARCHAR(10) NULL,
    `questClaimsJson` VARCHAR(512) NOT NULL DEFAULT '[]',
    `duoRewardDate` VARCHAR(10) NULL,
    `wishCompletedDate` VARCHAR(10) NULL,
    `lastMailRewardDate` VARCHAR(10) NULL,
    `postmanTrips` INTEGER NOT NULL DEFAULT 0,
    `sleepInterruptedUntil` DATETIME(3) NULL,
    `adoptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stateAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetActivity` (
    `id` VARCHAR(80) NOT NULL,
    `petId` INTEGER NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `action` VARCHAR(24) NOT NULL,
    `message` VARCHAR(160) NOT NULL,
    `xpEarned` INTEGER NOT NULL DEFAULT 0,
    `coinsUsed` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PetActivity_petId_createdAt_idx`(`petId`, `createdAt`),
    INDEX `PetActivity_role_createdAt_idx`(`role`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetLetter` (
    `id` VARCHAR(80) NOT NULL,
    `petId` INTEGER NOT NULL,
    `senderRole` VARCHAR(16) NOT NULL,
    `recipientRole` VARCHAR(16) NOT NULL,
    `theme` VARCHAR(24) NOT NULL DEFAULT 'miss',
    `satchel` VARCHAR(16) NOT NULL DEFAULT 'pink',
    `message` VARCHAR(400) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'waiting',
    `responseKind` VARCHAR(16) NULL,
    `responseText` VARCHAR(200) NULL,
    `openedAt` DATETIME(3) NULL,
    `respondedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PetLetter_recipientRole_status_createdAt_idx`(`recipientRole`, `status`, `createdAt`),
    INDEX `PetLetter_senderRole_createdAt_idx`(`senderRole`, `createdAt`),
    INDEX `PetLetter_petId_createdAt_idx`(`petId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetOwnedItem` (
    `id` VARCHAR(80) NOT NULL,
    `petId` INTEGER NOT NULL,
    `itemKey` VARCHAR(48) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'purchase',
    `acquiredByRole` VARCHAR(16) NULL,
    `acquiredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PetOwnedItem_petId_acquiredAt_idx`(`petId`, `acquiredAt`),
    UNIQUE INDEX `PetOwnedItem_petId_itemKey_key`(`petId`, `itemKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetRoomPlacement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `petId` INTEGER NOT NULL,
    `scene` VARCHAR(16) NOT NULL DEFAULT 'room',
    `slotKey` VARCHAR(24) NOT NULL,
    `itemKey` VARCHAR(48) NOT NULL,
    `updatedByRole` VARCHAR(16) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PetRoomPlacement_petId_updatedAt_idx`(`petId`, `updatedAt`),
    UNIQUE INDEX `PetRoomPlacement_petId_scene_slotKey_key`(`petId`, `scene`, `slotKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetFacility` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `petId` INTEGER NOT NULL,
    `facilityKey` VARCHAR(16) NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `updatedByRole` VARCHAR(16) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PetFacility_petId_facilityKey_key`(`petId`, `facilityKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GachaDraw` ADD CONSTRAINT `GachaDraw_customEggId_fkey` FOREIGN KEY (`customEggId`) REFERENCES `GachaEgg`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessageFavorite` ADD CONSTRAINT `ChatMessageFavorite_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ChatMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DrawGuessAttempt` ADD CONSTRAINT `DrawGuessAttempt_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `DrawGuessRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TruthOrDareQuestion` ADD CONSTRAINT `TruthOrDareQuestion_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `TruthOrDareRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PetActivity` ADD CONSTRAINT `PetActivity_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PetLetter` ADD CONSTRAINT `PetLetter_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PetOwnedItem` ADD CONSTRAINT `PetOwnedItem_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PetRoomPlacement` ADD CONSTRAINT `PetRoomPlacement_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PetFacility` ADD CONSTRAINT `PetFacility_petId_fkey` FOREIGN KEY (`petId`) REFERENCES `CouplePet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
