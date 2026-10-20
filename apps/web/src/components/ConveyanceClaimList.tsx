/**
 * ZENTRA Web — Conveyance Claim List Component (Phase 15)
 * apps/web/src/components/ConveyanceClaimList.tsx
 *
 * Filterable, searchable table displaying conveyance claims with status badges,
 * lineage information, and detail review navigation.
 */

import type { FC } from 'react';
import { useState, useMemo } from 'react';
import type { ConveyanceClaim, ConveyanceClaimStatus } from '@zentra/types';

interface ConveyanceClaimListProps {
  claims: ConveyanceClaim[];
  onSelectClaim: (claim: ConveyanceClaim) => void;
  selectedStatus?: string;
  onStatusChange?: (status: string) => void;
}

export const ConveyanceClaimList: FC<ConveyanceClaimListProps> = ({
  claims,
  onSelectClaim,
  selectedStatus = 'ALL',
  onStatusChange,
}) => {
  const [search, setSearch] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('ALL');

  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      // Status filter
      if (selectedStatus !== 'ALL' && claim.claimStatus !== selectedStatus) {
        return false;
      }
      // Mode filter
      if (selectedMode !== 'ALL' && claim.travelMode !== selectedMode) {
        return false;
      }
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesEngineer = claim.engineerName?.toLowerCase().includes(q) ?? false;
        const matchesSchool = claim.schoolName?.toLowerCase().includes(q) ?? false;
        const matchesDistrict = claim.districtName?.toLowerCase().includes(q) ?? false;
        const matchesCase = claim.serviceCaseNumber?.toLowerCase().includes(q) ?? false;
        const matchesId = claim.conveyanceClaimId.toLowerCase().includes(q);
        if (!matchesEngineer && !matchesSchool && !matchesDistrict && !matchesCase && !matchesId) {
          return false;
        }
      }
      return true;
    });
  }, [claims, selectedStatus, selectedMode, search]);

  const getStatusBadgeClass = (status: ConveyanceClaimStatus) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-slate-800 text-slate-300 border-slate-700';
      case 'SUBMITTED':
        return 'bg-blue-950/80 text-blue-300 border-blue-800';
      case 'UNDER_REVIEW':
        return 'bg-amber-950/80 text-amber-300 border-amber-800';
      case 'APPROVED':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
      case 'RETURNED_FOR_CORRECTION':
        return 'bg-orange-950/80 text-orange-300 border-orange-800';
      case 'REJECTED':
        return 'bg-rose-950/80 text-rose-300 border-rose-800';
      case 'PAID':
        return 'bg-sky-950/80 text-sky-300 border-sky-800';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Dropdown */}
          <select
            value={selectedStatus}
            onChange={(e) => onStatusChange?.(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-amber-500 focus:border-amber-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="APPROVED">Approved</option>
            <option value="RETURNED_FOR_CORRECTION">Returned for Correction</option>
            <option value="REJECTED">Rejected</option>
            <option value="PAID">Paid</option>
          </select>

          {/* Mode Dropdown */}
          <select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-amber-500 focus:border-amber-500"
          >
            <option value="ALL">All Travel Modes</option>
            <option value="BIKE">Two-Wheeler (Bike)</option>
            <option value="BUS">Public Bus</option>
            <option value="TRAIN">Train</option>
            <option value="AUTO">Auto Rickshaw</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        {/* Search input */}
        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Search engineer, school, case..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 placeholder-slate-500 focus:ring-amber-500 focus:border-amber-500"
          />
        </div>
      </div>

      {/* Claims Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-800/80 text-xs uppercase text-slate-400 font-semibold border-b border-slate-700">
            <tr>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Engineer</th>
              <th className="py-3 px-4">Case & School</th>
              <th className="py-3 px-4 text-center">Mode</th>
              <th className="py-3 px-4 text-right">Distance</th>
              <th className="py-3 px-4 text-right">Claimed</th>
              <th className="py-3 px-4 text-right">Approved</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredClaims.length > 0 ? (
              filteredClaims.map((claim) => (
                <tr key={claim.conveyanceClaimId} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4 text-xs font-mono text-slate-400 whitespace-nowrap">
                    {claim.travelDate}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-200">
                    {claim.engineerName || claim.engineerId.substring(0, 8)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-200">
                      {claim.schoolName || 'Hi-Tech Lab'}
                    </div>
                    <div className="text-xs text-slate-500">
                      Case: {claim.serviceCaseNumber || claim.serviceCaseId.substring(0, 8)}
                      {claim.districtName ? ` • ${claim.districtName}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center text-xs">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                      {claim.travelMode}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-300">
                    {claim.claimedDistanceKm} km
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-amber-400">
                    ₹{claim.claimedAmount.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-400 font-semibold">
                    {claim.approvedAmount !== null && claim.approvedAmount !== undefined
                      ? `₹${claim.approvedAmount.toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadgeClass(
                        claim.claimStatus,
                      )}`}
                    >
                      {claim.claimStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <button
                      onClick={() => onSelectClaim(claim)}
                      className="px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-xs font-semibold transition"
                    >
                      Inspect / Action
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  No conveyance claims matching the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500 pt-2 border-t border-slate-800 flex justify-between items-center">
        <span>Showing {filteredClaims.length} of {claims.length} claims</span>
        <span className="italic text-amber-500/80">
          Reimbursement formula: Distance (km) × Configured Policy Rate (₹/km)
        </span>
      </div>
    </div>
  );
};
