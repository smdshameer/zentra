/**
 * ZENTRA Web — Conveyance Dashboard Component (Phase 15)
 * apps/web/src/components/ConveyanceDashboard.tsx
 *
 * Visualizes conveyance summary stats, status pipeline distribution,
 * financial reimbursement totals, and district-wise breakdown.
 */

import type { FC } from 'react';
import type { ConveyanceSummaryStats } from '@zentra/types';

interface ConveyanceDashboardProps {
  stats: ConveyanceSummaryStats;
  onFilterByStatus?: (status: string) => void;
}

export const ConveyanceDashboard: FC<ConveyanceDashboardProps> = ({
  stats,
  onFilterByStatus,
}) => {
  return (
    <div className="space-y-6">
      {/* Financial Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Total Claimed Amount
          </span>
          <div className="text-2xl font-bold text-amber-400">
            ₹{stats.totalClaimedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-xs text-slate-500 mt-1 block">
            Across {stats.totalClaimsCount} total submitted claims
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Total Approved Amount
          </span>
          <div className="text-2xl font-bold text-emerald-400">
            ₹{stats.totalApprovedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-xs text-slate-500 mt-1 block">
            {stats.approvedCount + stats.paidCount} claims approved by coordinators
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Total Disbursed / Paid
          </span>
          <div className="text-2xl font-bold text-sky-400">
            ₹{stats.totalPaidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-xs text-slate-500 mt-1 block">
            {stats.paidCount} settled claims
          </span>
        </div>
      </div>

      {/* Claim Pipeline Status Counters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4">
          Claim Lifecycle Pipeline
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <button
            onClick={() => onFilterByStatus?.('DRAFT')}
            className="p-3 bg-slate-800/60 hover:bg-slate-800 rounded-lg border border-slate-700/60 text-left transition"
          >
            <span className="text-xs font-medium text-slate-400 block">Draft</span>
            <span className="text-xl font-bold text-slate-200">{stats.draftCount}</span>
          </button>

          <button
            onClick={() => onFilterByStatus?.('SUBMITTED')}
            className="p-3 bg-blue-950/40 hover:bg-blue-950/70 rounded-lg border border-blue-900/60 text-left transition"
          >
            <span className="text-xs font-medium text-blue-400 block">Submitted</span>
            <span className="text-xl font-bold text-blue-200">{stats.submittedCount}</span>
          </button>

          <button
            onClick={() => onFilterByStatus?.('UNDER_REVIEW')}
            className="p-3 bg-amber-950/40 hover:bg-amber-950/70 rounded-lg border border-amber-900/60 text-left transition"
          >
            <span className="text-xs font-medium text-amber-400 block">Under Review</span>
            <span className="text-xl font-bold text-amber-200">{stats.underReviewCount}</span>
          </button>

          <button
            onClick={() => onFilterByStatus?.('APPROVED')}
            className="p-3 bg-emerald-950/40 hover:bg-emerald-950/70 rounded-lg border border-emerald-900/60 text-left transition"
          >
            <span className="text-xs font-medium text-emerald-400 block">Approved</span>
            <span className="text-xl font-bold text-emerald-200">{stats.approvedCount}</span>
          </button>

          <button
            onClick={() => onFilterByStatus?.('RETURNED_FOR_CORRECTION')}
            className="p-3 bg-orange-950/40 hover:bg-orange-950/70 rounded-lg border border-orange-900/60 text-left transition"
          >
            <span className="text-xs font-medium text-orange-400 block">Returned</span>
            <span className="text-xl font-bold text-orange-200">{stats.returnedCount}</span>
          </button>

          <button
            onClick={() => onFilterByStatus?.('REJECTED')}
            className="p-3 bg-rose-950/40 hover:bg-rose-950/70 rounded-lg border border-rose-900/60 text-left transition"
          >
            <span className="text-xs font-medium text-rose-400 block">Rejected</span>
            <span className="text-xl font-bold text-rose-200">{stats.rejectedCount}</span>
          </button>

          <button
            onClick={() => onFilterByStatus?.('PAID')}
            className="p-3 bg-sky-950/40 hover:bg-sky-950/70 rounded-lg border border-sky-900/60 text-left transition"
          >
            <span className="text-xs font-medium text-sky-400 block">Paid</span>
            <span className="text-xl font-bold text-sky-200">{stats.paidCount}</span>
          </button>
        </div>
      </div>

      {/* District-wise Reimbursement Breakdown Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4">
          District-wise Claims Summary
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-800/80 text-xs uppercase text-slate-400 font-semibold border-b border-slate-700">
              <tr>
                <th className="py-3 px-4">District</th>
                <th className="py-3 px-4 text-center">Total Claims</th>
                <th className="py-3 px-4 text-right">Claimed Amount</th>
                <th className="py-3 px-4 text-right">Approved Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {stats.districtWiseBreakdown.length > 0 ? (
                stats.districtWiseBreakdown.map((row) => (
                  <tr key={row.districtId} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-medium text-slate-200">{row.districtName}</td>
                    <td className="py-3 px-4 text-center text-slate-300">{row.claimsCount}</td>
                    <td className="py-3 px-4 text-right font-mono text-amber-400">
                      ₹{row.totalClaimedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-400 font-medium">
                      ₹{row.totalApprovedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    No district conveyance activity recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
