/**
 * ZENTRA Web — Conveyance Claims & Management Web Portal (Phase 15)
 * apps/web/src/App.tsx
 *
 * Implements interactive management portal for supervisor/admin claim review:
 * - Dynamic role switching (MASTER_ADMIN, DISTRICT_COORDINATOR, REPORTING_HEAD, FIELD_ENGINEER)
 * - Conveyance overview dashboard with financial aggregates & district breakdown
 * - Filterable claims list with lifecycle status badges
 * - Detail inspection modal with calculation transparency & self-approval prevention
 */

import { useState, useMemo } from 'react';
import { SYSTEM_CONSTANTS } from '@zentra/config';
import { nowUtcIso, formatUtcToIst } from '@zentra/shared';
import type { ConveyanceClaim, ConveyanceSummaryStats, ConveyanceClaimStatus } from '@zentra/types';
import { ConveyanceDashboard } from './components/ConveyanceDashboard';
import { ConveyanceClaimList } from './components/ConveyanceClaimList';
import { ConveyanceClaimDetailModal } from './components/ConveyanceClaimDetailModal';

export type UserRoleOption =
  | 'MASTER_ADMIN'
  | 'DISTRICT_COORDINATOR'
  | 'REPORTING_HEAD'
  | 'FIELD_ENGINEER';

interface MockUser {
  userId: string;
  role: UserRoleOption;
  fullName: string;
  districtId: string;
}

const USERS: Record<UserRoleOption, MockUser> = {
  MASTER_ADMIN: {
    userId: '00000000-0000-0000-0000-000000000001',
    role: 'MASTER_ADMIN',
    fullName: 'Master Administrator',
    districtId: 'statewide',
  },
  DISTRICT_COORDINATOR: {
    userId: '00000000-0000-0000-0000-000000000002',
    role: 'DISTRICT_COORDINATOR',
    fullName: 'Salem District Coordinator',
    districtId: 'd1111111-1111-1111-1111-111111111111',
  },
  REPORTING_HEAD: {
    userId: '00000000-0000-0000-0000-000000000003',
    role: 'REPORTING_HEAD',
    fullName: 'State Reporting Head',
    districtId: 'statewide',
  },
  FIELD_ENGINEER: {
    userId: '00000000-0000-0000-0000-000000000004',
    role: 'FIELD_ENGINEER',
    fullName: 'Prakash Raman (Field Engineer)',
    districtId: 'd1111111-1111-1111-1111-111111111111',
  },
};

const INITIAL_CLAIMS: ConveyanceClaim[] = [
  {
    conveyanceClaimId: 'c1000000-0000-0000-0000-000000000001',
    visitId: 'v1000000-0000-0000-0000-000000000001',
    serviceCaseId: 'sc100000-0000-0000-0000-000000000001',
    engineerId: '00000000-0000-0000-0000-000000000004',
    policyId: 'p1000000-0000-0000-0000-000000000001',
    travelDate: '2026-10-07',
    fromLocation: 'Salem Base Office',
    toLocation: 'Govt Model HSS, Omalur',
    travelMode: 'BIKE',
    startingOdometerKm: 14250,
    endingOdometerKm: 14282,
    calculatedOdometerDistanceKm: 32,
    gpsDistanceKm: 31.8,
    claimedDistanceKm: 32,
    approvedDistanceKm: null,
    appliedRatePerKm: 5.0,
    ratePolicyVersion: 1,
    isProvisionalPolicy: true,
    calculatedAmount: 160.0,
    claimedAmount: 160.0,
    approvedAmount: null,
    claimStatus: 'SUBMITTED',
    submittedAt: '2026-10-07T14:30:00.000Z',
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    correctionNotes: null,
    remarks: 'Field visit attendance for server diagnosis',
    version: 1,
    clientOperationId: null,
    isTombstoned: false,
    isDeleted: false,
    createdAt: '2026-10-07T14:30:00.000Z',
    updatedAt: '2026-10-07T14:30:00.000Z',
    engineerName: 'Prakash Raman (Field Engineer)',
    serviceCaseNumber: 'CSE-SLM-2026-0042',
    schoolName: 'Govt Model HSS, Omalur',
    districtName: 'Salem',
  },
  {
    conveyanceClaimId: 'c1000000-0000-0000-0000-000000000002',
    visitId: 'v1000000-0000-0000-0000-000000000002',
    serviceCaseId: 'sc100000-0000-0000-0000-000000000002',
    engineerId: '00000000-0000-0000-0000-000000000004',
    policyId: 'p1000000-0000-0000-0000-000000000002',
    travelDate: '2026-10-06',
    fromLocation: 'Salem Hub',
    toLocation: 'GHSS Attur',
    travelMode: 'BUS',
    startingOdometerKm: null,
    endingOdometerKm: null,
    calculatedOdometerDistanceKm: null,
    gpsDistanceKm: 55.0,
    claimedDistanceKm: 55,
    approvedDistanceKm: 55,
    appliedRatePerKm: 2.5,
    ratePolicyVersion: 1,
    isProvisionalPolicy: true,
    calculatedAmount: 137.5,
    claimedAmount: 137.5,
    approvedAmount: 137.5,
    claimStatus: 'APPROVED',
    submittedAt: '2026-10-06T16:00:00.000Z',
    reviewedByUserId: '00000000-0000-0000-0000-000000000002',
    reviewedAt: '2026-10-07T10:00:00.000Z',
    rejectionReason: null,
    correctionNotes: null,
    remarks: 'Express bus transit for interactive panel repair',
    version: 2,
    clientOperationId: null,
    isTombstoned: false,
    isDeleted: false,
    createdAt: '2026-10-06T16:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    engineerName: 'Prakash Raman (Field Engineer)',
    serviceCaseNumber: 'CSE-SLM-2026-0038',
    schoolName: 'GHSS Attur',
    districtName: 'Salem',
    reviewerName: 'Salem District Coordinator',
  },
  {
    conveyanceClaimId: 'c1000000-0000-0000-0000-000000000003',
    visitId: 'v1000000-0000-0000-0000-000000000003',
    serviceCaseId: 'sc100000-0000-0000-0000-000000000003',
    engineerId: '00000000-0000-0000-0000-000000000005',
    policyId: 'p1000000-0000-0000-0000-000000000004',
    travelDate: '2026-10-05',
    fromLocation: 'Trichy Junction',
    toLocation: 'Govt Girls HSS, Thiruverumbur',
    travelMode: 'AUTO',
    startingOdometerKm: null,
    endingOdometerKm: null,
    calculatedOdometerDistanceKm: null,
    gpsDistanceKm: 14.5,
    claimedDistanceKm: 15,
    approvedDistanceKm: 15,
    appliedRatePerKm: 8.0,
    ratePolicyVersion: 1,
    isProvisionalPolicy: true,
    calculatedAmount: 120.0,
    claimedAmount: 120.0,
    approvedAmount: 120.0,
    claimStatus: 'PAID',
    submittedAt: '2026-10-05T17:00:00.000Z',
    reviewedByUserId: '00000000-0000-0000-0000-000000000001',
    reviewedAt: '2026-10-06T09:00:00.000Z',
    rejectionReason: null,
    correctionNotes: null,
    remarks: 'Auto fare disbursed via batch payment #88392',
    version: 3,
    clientOperationId: null,
    isTombstoned: false,
    isDeleted: false,
    createdAt: '2026-10-05T17:00:00.000Z',
    updatedAt: '2026-10-06T09:00:00.000Z',
    engineerName: 'Karthik Subramanian',
    serviceCaseNumber: 'CSE-TRY-2026-0019',
    schoolName: 'Govt Girls HSS, Thiruverumbur',
    districtName: 'Tiruchirappalli',
    reviewerName: 'Master Administrator',
  },
  {
    conveyanceClaimId: 'c1000000-0000-0000-0000-000000000004',
    visitId: 'v1000000-0000-0000-0000-000000000004',
    serviceCaseId: 'sc100000-0000-0000-0000-000000000004',
    engineerId: '00000000-0000-0000-0000-000000000005',
    policyId: 'p1000000-0000-0000-0000-000000000001',
    travelDate: '2026-10-08',
    fromLocation: 'Trichy Base',
    toLocation: 'GHS Lalgudi',
    travelMode: 'BIKE',
    startingOdometerKm: 22100,
    endingOdometerKm: 22144,
    calculatedOdometerDistanceKm: 44,
    gpsDistanceKm: 43.5,
    claimedDistanceKm: 44,
    approvedDistanceKm: null,
    appliedRatePerKm: 5.0,
    ratePolicyVersion: 1,
    isProvisionalPolicy: true,
    calculatedAmount: 220.0,
    claimedAmount: 220.0,
    approvedAmount: null,
    claimStatus: 'UNDER_REVIEW',
    submittedAt: '2026-10-08T11:00:00.000Z',
    reviewedByUserId: '00000000-0000-0000-0000-000000000001',
    reviewedAt: '2026-10-08T12:00:00.000Z',
    rejectionReason: null,
    correctionNotes: null,
    remarks: 'Dual-visit attendance for UPS failure and projector check',
    version: 2,
    clientOperationId: null,
    isTombstoned: false,
    isDeleted: false,
    createdAt: '2026-10-08T11:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    engineerName: 'Karthik Subramanian',
    serviceCaseNumber: 'CSE-TRY-2026-0024',
    schoolName: 'GHS Lalgudi',
    districtName: 'Tiruchirappalli',
    reviewerName: 'Master Administrator',
  },
];

export function App() {
  const [activeRole, setActiveRole] = useState<UserRoleOption>('DISTRICT_COORDINATOR');
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'CLAIMS'>('DASHBOARD');
  const [claims, setClaims] = useState<ConveyanceClaim[]>(INITIAL_CLAIMS);
  const [selectedClaim, setSelectedClaim] = useState<ConveyanceClaim | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const currentUser = USERS[activeRole];
  const currentTimeUtc = nowUtcIso();
  const currentTimeIst = formatUtcToIst(currentTimeUtc);

  // Compute live summary statistics based on current claims dataset
  const summaryStats: ConveyanceSummaryStats = useMemo(() => {
    let draft = 0;
    let submitted = 0;
    let underReview = 0;
    let approved = 0;
    let rejected = 0;
    let returned = 0;
    let paid = 0;
    let claimedTotal = 0;
    let approvedTotal = 0;
    let paidTotal = 0;

    const districtMap = new Map<string, { name: string; count: number; claimed: number; approved: number }>();

    for (const c of claims) {
      if (c.claimStatus === 'DRAFT') draft++;
      else if (c.claimStatus === 'SUBMITTED') submitted++;
      else if (c.claimStatus === 'UNDER_REVIEW') underReview++;
      else if (c.claimStatus === 'APPROVED') approved++;
      else if (c.claimStatus === 'REJECTED') rejected++;
      else if (c.claimStatus === 'RETURNED_FOR_CORRECTION') returned++;
      else if (c.claimStatus === 'PAID') paid++;

      claimedTotal += c.claimedAmount;
      if (c.approvedAmount) {
        approvedTotal += c.approvedAmount;
      }
      if (c.claimStatus === 'PAID' && c.approvedAmount) {
        paidTotal += c.approvedAmount;
      }

      const distName = c.districtName || 'Unknown District';
      const existing = districtMap.get(distName) || { name: distName, count: 0, claimed: 0, approved: 0 };
      existing.count++;
      existing.claimed += c.claimedAmount;
      if (c.approvedAmount) existing.approved += c.approvedAmount;
      districtMap.set(distName, existing);
    }

    const districtWiseBreakdown = Array.from(districtMap.entries()).map(([key, val]) => ({
      districtId: key,
      districtName: val.name,
      claimsCount: val.count,
      totalClaimedAmount: val.claimed,
      totalApprovedAmount: val.approved,
    }));

    return {
      totalClaimsCount: claims.length,
      draftCount: draft,
      submittedCount: submitted,
      underReviewCount: underReview,
      approvedCount: approved,
      rejectedCount: rejected,
      returnedCount: returned,
      paidCount: paid,
      totalClaimedAmount: claimedTotal,
      totalApprovedAmount: approvedTotal,
      totalPaidAmount: paidTotal,
      districtWiseBreakdown,
    };
  }, [claims]);

  // Review handlers
  const handleStartReview = async (claimId: string) => {
    setClaims((prev) =>
      prev.map((c) =>
        c.conveyanceClaimId === claimId
          ? {
              ...c,
              claimStatus: 'UNDER_REVIEW' as ConveyanceClaimStatus,
              reviewedByUserId: currentUser.userId,
              reviewedAt: new Date().toISOString(),
              reviewerName: currentUser.fullName,
              version: c.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    setSelectedClaim((prev) =>
      prev && prev.conveyanceClaimId === claimId
        ? {
            ...prev,
            claimStatus: 'UNDER_REVIEW',
            reviewedByUserId: currentUser.userId,
            reviewedAt: new Date().toISOString(),
            reviewerName: currentUser.fullName,
            version: prev.version + 1,
            updatedAt: new Date().toISOString(),
          }
        : prev,
    );
  };

  const handleApprove = async (
    claimId: string,
    approvedDistanceKm?: number,
    approvedAmount?: number,
    notes?: string,
  ) => {
    setClaims((prev) =>
      prev.map((c) => {
        if (c.conveyanceClaimId !== claimId) return c;
        const dist = approvedDistanceKm ?? c.claimedDistanceKm;
        const amt = approvedAmount ?? Math.round(dist * c.appliedRatePerKm * 100) / 100;
        return {
          ...c,
          claimStatus: 'APPROVED' as ConveyanceClaimStatus,
          approvedDistanceKm: dist,
          approvedAmount: amt,
          reviewedByUserId: currentUser.userId,
          reviewedAt: new Date().toISOString(),
          reviewerName: currentUser.fullName,
          remarks: notes || c.remarks,
          version: c.version + 1,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    setSelectedClaim(null);
  };

  const handleReject = async (claimId: string, reason: string) => {
    setClaims((prev) =>
      prev.map((c) =>
        c.conveyanceClaimId === claimId
          ? {
              ...c,
              claimStatus: 'REJECTED' as ConveyanceClaimStatus,
              rejectionReason: reason,
              reviewedByUserId: currentUser.userId,
              reviewedAt: new Date().toISOString(),
              reviewerName: currentUser.fullName,
              version: c.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    setSelectedClaim(null);
  };

  const handleReturn = async (claimId: string, correctionNotes: string) => {
    setClaims((prev) =>
      prev.map((c) =>
        c.conveyanceClaimId === claimId
          ? {
              ...c,
              claimStatus: 'RETURNED_FOR_CORRECTION' as ConveyanceClaimStatus,
              correctionNotes,
              reviewedByUserId: currentUser.userId,
              reviewedAt: new Date().toISOString(),
              reviewerName: currentUser.fullName,
              version: c.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    setSelectedClaim(null);
  };

  const handlePay = async (claimId: string, paymentReference?: string) => {
    setClaims((prev) =>
      prev.map((c) =>
        c.conveyanceClaimId === claimId
          ? {
              ...c,
              claimStatus: 'PAID' as ConveyanceClaimStatus,
              remarks: paymentReference
                ? `Paid ref: ${paymentReference}. ${c.remarks || ''}`
                : c.remarks,
              version: c.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    setSelectedClaim(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center space-x-4">
          <div className="h-9 w-9 bg-amber-500 rounded-lg flex items-center justify-center font-black text-slate-950 text-base shadow-sm">
            Z
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-extrabold text-base leading-tight tracking-wide text-white">
                {SYSTEM_CONSTANTS.APP_NAME}
              </h1>
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                Phase 15 Portal
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Conveyance Claims & Reimbursement Management
            </p>
          </div>
        </div>

        {/* Navigation Tabs & Active Role Switcher */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center bg-slate-800/80 p-1 rounded-lg border border-slate-700/60">
            <button
              onClick={() => setActiveTab('DASHBOARD')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                activeTab === 'DASHBOARD'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Overview Dashboard
            </button>
            <button
              onClick={() => setActiveTab('CLAIMS')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                activeTab === 'CLAIMS'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Claims Queue ({claims.length})
            </button>
          </div>

          {/* Role Switcher Pill */}
          <div className="flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden md:inline">
              Role:
            </span>
            <select
              value={activeRole}
              onChange={(e) => setActiveRole(e.target.value as UserRoleOption)}
              className="bg-transparent text-xs font-bold text-amber-400 focus:outline-none cursor-pointer"
            >
              <option value="DISTRICT_COORDINATOR" className="bg-slate-900 text-slate-200">
                District Coordinator
              </option>
              <option value="MASTER_ADMIN" className="bg-slate-900 text-slate-200">
                Master Admin
              </option>
              <option value="REPORTING_HEAD" className="bg-slate-900 text-slate-200">
                Reporting Head
              </option>
              <option value="FIELD_ENGINEER" className="bg-slate-900 text-slate-200">
                Field Engineer
              </option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* User Context Banner */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3.5 bg-slate-900/60 border border-slate-800/80 rounded-xl text-xs text-slate-400 gap-2">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
            <span>
              Signed in as <strong className="text-slate-200">{currentUser.fullName}</strong>
            </span>
            <span className="text-slate-600">•</span>
            <span>Role: <strong className="text-amber-400">{currentUser.role}</strong></span>
          </div>
          <div className="flex items-center space-x-3 text-slate-500">
            <span>IST: {currentTimeIst}</span>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'DASHBOARD' && (
          <ConveyanceDashboard
            stats={summaryStats}
            onFilterByStatus={(status) => {
              setFilterStatus(status);
              setActiveTab('CLAIMS');
            }}
          />
        )}

        {activeTab === 'CLAIMS' && (
          <ConveyanceClaimList
            claims={claims}
            selectedStatus={filterStatus}
            onStatusChange={setFilterStatus}
            onSelectClaim={(claim) => setSelectedClaim(claim)}
          />
        )}
      </main>

      {/* Detail / Action Modal */}
      {selectedClaim && (
        <ConveyanceClaimDetailModal
          claim={selectedClaim}
          currentUser={currentUser}
          onClose={() => setSelectedClaim(null)}
          onStartReview={handleStartReview}
          onApprove={handleApprove}
          onReject={handleReject}
          onReturn={handleReturn}
          onPay={handlePay}
        />
      )}

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 px-6 py-3.5 text-center text-xs text-slate-500">
        &copy; 2026 {SYSTEM_CONSTANTS.APP_NAME} — Phase 15 Conveyance Claims & Management Web Portal
      </footer>
    </div>
  );
}
