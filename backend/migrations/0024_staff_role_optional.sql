-- Migration 0024: Decouple role from staff identity
-- HR creates staff without a role. Access Management assigns role + interface scope.

ALTER TABLE "staff" ALTER COLUMN "role" DROP NOT NULL;
