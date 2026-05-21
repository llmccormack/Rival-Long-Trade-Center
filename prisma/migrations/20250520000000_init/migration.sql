Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "industry" TEXT,
    "exchange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fundamental" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'annual',
    "revenue" DOUBLE PRECISION,
    "grossProfit" DOUBLE PRECISION,
    "operatingIncome" DOUBLE PRECISION,
    "netIncome" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "epsDiluted" DOUBLE PRECISION,
    "dividendPerShare" DOUBLE PRECISION,
    "totalAssets" DOUBLE PRECISION,
    "totalLiabilities" DOUBLE PRECISION,
    "totalEquity" DOUBLE PRECISION,
    "bookValuePerShare" DOUBLE PRECISION,
    "currentAssets" DOUBLE PRECISION,
    "currentLiabilities" DOUBLE PRECISION,
    "longTermDebt" DOUBLE PRECISION,
    "cash" DOUBLE PRECISION,
    "operatingCashFlow" DOUBLE PRECISION,
    "capitalExpenditures" DOUBLE PRECISION,
    "freeCashFlow" DOUBLE PRECISION,
    "depreciation" DOUBLE PRECISION,
    "pe" DOUBLE PRECISION,
    "pb" DOUBLE PRECISION,
    "debtToEquity" DOUBLE PRECISION,
    "currentRatio" DOUBLE PRECISION,
    "roe" DOUBLE PRECISION,
    "roic" DOUBLE PRECISION,
    "ownerEarnings" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "sharesOutstanding" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fundamental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntrinsicValue" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "grahamNumber" DOUBLE PRECISION,
    "dcfValue" DOUBLE PRECISION,
    "intrinsicValue" DOUBLE PRECISION NOT NULL,
    "marginOfSafety" DOUBLE PRECISION NOT NULL,
    "isBuySignal" BOOLEAN NOT NULL DEFAULT false,
    "ownerEarnings" DOUBLE PRECISION,
    "growthRateUsed" DOUBLE PRECISION,
    "discountRateUsed" DOUBLE PRECISION,
    "terminalGrowth" DOUBLE PRECISION,

    CONSTRAINT "IntrinsicValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenResult" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passedPE" BOOLEAN NOT NULL,
    "passedPB" BOOLEAN NOT NULL,
    "passedCurrentRatio" BOOLEAN NOT NULL,
    "passedDebtToAssets" BOOLEAN NOT NULL,
    "passedEpsGrowth" BOOLEAN NOT NULL,
    "passedDividends" BOOLEAN NOT NULL,
    "passedNoDeficit" BOOLEAN NOT NULL,
    "overallPass" BOOLEAN NOT NULL,
    "peValue" DOUBLE PRECISION,
    "pbValue" DOUBLE PRECISION,
    "currentRatioValue" DOUBLE PRECISION,
    "debtToAssetsValue" DOUBLE PRECISION,
    "epsGrowthValue" DOUBLE PRECISION,
    "dividendYears" INTEGER,

    CONSTRAINT "ScreenResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetPrice" DOUBLE PRECISION,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "avgCostBasis" DOUBLE PRECISION NOT NULL,
    "firstPurchased" TIMESTAMP(3) NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "schwabAccountId" TEXT,
    "schwabOrderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperPortfolioItem" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "avgCostBasis" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "firstPurchased" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "philosophyScore" INTEGER,
    "conviction" TEXT,
    "mosAtPurchase" DOUBLE PRECISION,
    "auditTrail" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dividendsEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMP(3),
    "closePrice" DOUBLE PRECISION,
    "closeReason" TEXT,

    CONSTRAINT "PaperPortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'paper',
    "minPhilosophyScore" INTEGER NOT NULL DEFAULT 55,
    "minMarginOfSafety" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "maxPositionPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "totalCapital" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "maxPositions" INTEGER NOT NULL DEFAULT 15,
    "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "minCashReservePct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "maxSectorPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "autoDiscovery" BOOLEAN NOT NULL DEFAULT true,
    "dailyAnalysisLimit" INTEGER NOT NULL DEFAULT 25,
    "schwabAccountId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunResult" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "maxDailyTrades" INTEGER NOT NULL DEFAULT 5,
    "maxDailyNotional" DOUBLE PRECISION NOT NULL DEFAULT 2000,
    "maxSingleNotional" DOUBLE PRECISION NOT NULL DEFAULT 1000,

    CONSTRAINT "AutopilotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchwabToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchwabToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "stockId" TEXT,
    "ticker" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuarterlyRebalance" (
    "id" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "actions" JSONB NOT NULL,

    CONSTRAINT "QuarterlyRebalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "gainLossPct" DOUBLE PRECISION NOT NULL,
    "spyPrice" DOUBLE PRECISION,
    "positions" JSONB NOT NULL,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Stock_ticker_key" ON "Stock"("ticker");

-- CreateIndex
CREATE INDEX "Fundamental_stockId_idx" ON "Fundamental"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "Fundamental_stockId_year_period_key" ON "Fundamental"("stockId", "year", "period");

-- CreateIndex
CREATE INDEX "IntrinsicValue_stockId_idx" ON "IntrinsicValue"("stockId");

-- CreateIndex
CREATE INDEX "ScreenResult_stockId_idx" ON "ScreenResult"("stockId");

-- CreateIndex
CREATE INDEX "ScreenResult_overallPass_idx" ON "ScreenResult"("overallPass");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_stockId_key" ON "WatchlistItem"("stockId");

-- CreateIndex
CREATE INDEX "PortfolioItem_stockId_idx" ON "PortfolioItem"("stockId");

-- CreateIndex
CREATE INDEX "PaperPortfolioItem_stockId_idx" ON "PaperPortfolioItem"("stockId");

-- CreateIndex
CREATE INDEX "PaperPortfolioItem_isOpen_idx" ON "PaperPortfolioItem"("isOpen");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "SchwabToken_accountId_key" ON "SchwabToken"("accountId");

-- CreateIndex
CREATE INDEX "Alert_isRead_idx" ON "Alert"("isRead");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_date_idx" ON "PortfolioSnapshot"("date");

-- AddForeignKey
ALTER TABLE "Fundamental" ADD CONSTRAINT "Fundamental_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntrinsicValue" ADD CONSTRAINT "IntrinsicValue_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenResult" ADD CONSTRAINT "ScreenResult_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPortfolioItem" ADD CONSTRAINT "PaperPortfolioItem_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

