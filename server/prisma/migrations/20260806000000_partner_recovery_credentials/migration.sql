-- Recovery credentials belong to one member, never to the couple as a whole.
-- Existing couple-wide recovery codes are deliberately invalidated because
-- there is no safe way to infer which member owned them.

CREATE TABLE `PartnerRecoveryCredential` (
    `coupleId` VARCHAR(64) NOT NULL,
    `partnerRole` ENUM('partnerA', 'partnerB') NOT NULL,
    `codeHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PartnerRecoveryCredential_codeHash_key`(`codeHash`),
    PRIMARY KEY (`coupleId`, `partnerRole`),
    CONSTRAINT `PartnerRecoveryCredential_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The create and activation hashes are lifecycle replay markers. The recovery
-- rotation hash chains idempotent rotations across ordinary token refreshes;
-- logout, recovery, or rebind clears it.
ALTER TABLE `DeviceSession`
    ADD COLUMN `lastCreateRequestHash` VARCHAR(64) NULL,
    ADD COLUMN `lastActivationCodeHash` VARCHAR(64) NULL,
    ADD COLUMN `lastRecoveryRotationRequestHash` VARCHAR(64) NULL;

-- Keep a membership marker for every role that has ever been activated. The
-- old couple-wide secret cannot be assigned safely, so these rows deliberately
-- start without a usable code; an authenticated member can rotate their own.
INSERT INTO `PartnerRecoveryCredential` (
    `coupleId`,
    `partnerRole`,
    `codeHash`,
    `createdAt`,
    `updatedAt`
)
SELECT
    `coupleId`,
    `partnerRole`,
    NULL,
    MIN(`createdAt`),
    CURRENT_TIMESTAMP(3)
FROM `DeviceSession`
GROUP BY `coupleId`, `partnerRole`;

-- `paired` records historical membership, not whether both devices are
-- currently online. Repair spaces that an older activation flow left open
-- after one member logged out or moved to another space.
UPDATE `Couple` AS `couple`
INNER JOIN (
    SELECT `coupleId`
    FROM `PartnerRecoveryCredential`
    GROUP BY `coupleId`
    HAVING COUNT(*) >= 2
) AS `boundCouple` ON `boundCouple`.`coupleId` = `couple`.`id`
SET `couple`.`status` = 'paired';

-- Codes created before the first member chose a role were ambiguous. Old
-- partner-issued recovery invitations could also be used to take over the
-- other role. New clients use self-owned recovery credentials instead.
UPDATE `Couple`
SET
    `pairingCodeHash` = NULL,
    `pairingCodeExpiresAt` = NULL,
    `pairingTargetRole` = NULL,
    `pairingPurpose` = NULL
WHERE
    `pairingCodeHash` IS NOT NULL
    AND (
        `status` = 'paired'
        OR `pairingTargetRole` IS NULL
        OR `pairingPurpose` IS NULL
        OR `pairingPurpose` <> 'join'
        OR EXISTS (
            SELECT 1
            FROM `PartnerRecoveryCredential` AS `credential`
            WHERE
                `credential`.`coupleId` = `Couple`.`id`
                AND `credential`.`partnerRole` = `Couple`.`pairingTargetRole`
        )
    );

ALTER TABLE `Couple`
    DROP INDEX `Couple_recoveryCodeHash_key`,
    DROP COLUMN `recoveryCodeHash`;
