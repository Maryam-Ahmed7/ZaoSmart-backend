-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "diseaseId" TEXT;

-- CreateIndex
CREATE INDEX "Scan_diseaseId_idx" ON "Scan"("diseaseId");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_diseaseId_fkey" FOREIGN KEY ("diseaseId") REFERENCES "Disease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
