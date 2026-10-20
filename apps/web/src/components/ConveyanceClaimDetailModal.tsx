/**
 * ZENTRA Web — Conveyance Claim Detail & Review Modal (Phase 15)
 * apps/web/src/components/ConveyanceClaimDetailModal.tsx
 *
 * Provides complete calculation transparency, odometer verification,
 * self-approval prevention guards, and interactive administrative review actions.
 */

import type { FC } from 'react';
import { useState } from 'react';
import type { ConveyanceClaim } from '@zentra/types';

interface ConveyanceClaimDetailModalProps {
  claim: ConveyanceClaim;
  currentUser: {
    userId: string;
    role: string;
    fullName: string;
  };
  onClose: () => void;
  onStartReview: (claimId: string) => Promise<void>;
  onApprove: (claimId: string, approvedDistanceKm?: number, approvedAmount?: number, notes?: string) => Promise<void>;
  onReject: (claimId: string, rejectionReason: string) => Promise<void>;
  onReturn: (claimId: string, correctionNotes: string) => Promise<void>;
  onPay: (claimId: string, paymentReference?: string) => Promise<void>;
}

export const ConveyanceClaimDetailModal: FC<ConveyanceClaimDetailModalProps> = ({
  claim,
  currentUser,
  onClose,
  onStartReview,
  onApprove,
  onReject,
  onReturn,
  onPay,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionTab, setActionTab] = useState<'DETAILS' | 'APPROVE' | 'REJECT' | 'RETURN' | 'PAY'>('DETAILS');

  // Approval form state
  const [approvedDistance, setApprovedDistance] = useState(String(claim.claimedDistanceKm));
  const [customApprovedAmount, setCustomApprovedAmount] = useState(
    claim.approvedAmount !== null && claim.approvedAmount !== undefined
      ? String(claim.approvedAmount)
      : String(claim.calculatedAmount),
  );
  const [approvalNotes, setApprovalNotes] = useState('');

  // Rejection & Return form state
  const [rejectionReason, setRejectionReason] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const isClaimOwner = claim.engineerId === currentUser.userId;
  const canReviewOrApprove =
    currentUser.role === 'MASTER_ADMIN' ||
    currentUser.role === 'DISTRICT_COORDINATOR' ||
    currentUser.role === 'REPORTING_HEAD';
  const canDisburse =
    currentUser.role === 'MASTER_ADMIN' || currentUser.role === 'REPORTING_HEAD';

  // Strict self-approval prevention check
  const isSelfApprovalBlocked = isClaimOwner && canReviewOrApprove;

  const handleStartReviewAction = async () => {
    setIsSubmitting(true);
    try {
      await onStartReview(claim.conveyanceClaimId);
      setActionTab('DETAILS');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveAction = async () => {
    setIsSubmitting(true);
    try {
      const dist = approvedDistance ? parseFloat(approvedDistance) : undefined;
      const amt = customApprovedAmount ? parseFloat(customApprovedAmount) : undefined;
      await onApprove(claim.conveyanceClaimId, dist, amt, approvalNotes || undefined);
      setActionTab('DETAILS');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectAction = async () => {
    if (!rejectionReason.trim()) {
      alert('Please specify a rejection reason');
      return;
    }
    setIsSubmitting(true);
    try {
      await onReject(claim.conveyanceClaimId, rejectionReason);
      setActionTab('DETAILS');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnAction = async () => {
    if (!correctionNotes.trim()) {
      alert('Please specify instructions for the engineer to correct');
      return;
    }
    setIsSubmitting(true);
    try {
      await onReturn(claim.conveyanceClaimId, correctionNotes);
      setActionTab('DETAILS');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayAction = async () => {
    setIsSubmitting(true);
    try {
      await onPay(claim.conveyanceClaimId, paymentReference || undefined);
      setActionTab('DETAILS');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono text-slate-500">CLAIM ID</span>
              <span className="text-xs font-mono font-bold text-slate-300">
                {claim.conveyanceClaimId}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 mt-0.5">
              Conveyance Reimbursement Review
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl font-bold p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Self-approval prohibition warning banner */}
          {isSelfApprovalBlocked && (
            <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center space-x-3">
              <span className="text-lg">⚠️</span>
              <div>
                <strong>SELF-APPROVAL PROHIBITION:</strong> You are the author of this conveyance claim.
                Field engineers and coordinators cannot approve their own reimbursement claims. Approval authority is disabled.
              </div>
            </div>
          )}

          {/* Lineage & Trip Details */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-800 text-xs">
            <div>
              <span className="text-slate-500 block">Travel Date</span>
              <span className="font-semibold text-slate-200">{claim.travelDate}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Engineer</span>
              <span className="font-semibold text-slate-200">
                {claim.engineerName || claim.engineerId.substring(0, 8)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Travel Mode</span>
              <span className="font-semibold text-amber-400">{claim.travelMode}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Status</span>
              <span className="font-semibold text-emerald-400">{claim.claimStatus}</span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block">School & Location</span>
              <span className="font-medium text-slate-300">
                {claim.schoolName || 'Hi-Tech Lab'} {claim.districtName ? `(${claim.districtName})` : ''}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block">Service Case</span>
              <span className="font-medium text-slate-300">
                {claim.serviceCaseNumber || claim.serviceCaseId}
              </span>
            </div>
          </div>

          {/* Odometer & Mileage Lineage */}
          <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Distance & Odometer Verification
              </h4>
              {claim.submittedByUserId && claim.submittedByUserId !== claim.engineerId && (
                <span className="text-[10px] bg-sky-950/80 text-sky-300 border border-sky-800/60 px-2 py-0.5 rounded-full font-mono">
                  Proxy Submitted by {claim.submittedByName || 'Coordinator'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Starting Odometer</span>
                <span className="font-mono text-sm font-semibold text-slate-200">
                  {claim.startingOdometerKm !== null && claim.startingOdometerKm !== undefined
                    ? `${claim.startingOdometerKm} km`
                    : 'N/A'}
                </span>
              </div>
              <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Captured / Evidenced</span>
                <span className="font-mono text-sm font-semibold text-slate-200">
                  {claim.capturedDistanceKm !== null && claim.capturedDistanceKm !== undefined
                    ? `${claim.capturedDistanceKm} km`
                    : 'N/A'}
                </span>
              </div>
              <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Claimed Distance</span>
                <span className="font-mono text-sm font-bold text-amber-400">
                  {claim.claimedDistanceKm} km
                </span>
              </div>
              <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Approved Distance</span>
                <span className="font-mono text-sm font-bold text-emerald-400">
                  {claim.approvedDistanceKm !== null && claim.approvedDistanceKm !== undefined
                    ? `${claim.approvedDistanceKm} km`
                    : 'Pending'}
                </span>
              </div>
            </div>
          </div>

          {/* Calculation Transparency Breakdown Card */}
          <div className="bg-slate-800/60 p-4 rounded-xl border border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                Transparent Reimbursement Calculation
              </h4>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Policy v{claim.ratePolicyVersion}
              </span>
            </div>

            <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1 font-mono text-xs">
              <div className="text-slate-300">
                Formula: {claim.claimedDistanceKm} km × ₹{claim.appliedRatePerKm.toFixed(2)}/km = ₹
                {claim.calculatedAmount.toFixed(2)}
              </div>
              <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800 text-[11px]">
                <span>Applied Rate: ₹{claim.appliedRatePerKm.toFixed(2)}/km</span>
                <span className="text-amber-400 font-bold">
                  Claimed Amount: ₹{claim.claimedAmount.toFixed(2)}
                </span>
              </div>
              {claim.approvedAmount !== null && claim.approvedAmount !== undefined && (
                <div className="flex justify-between text-emerald-400 pt-1 border-t border-slate-800 text-xs font-bold">
                  <span>Approved Distance: {claim.approvedDistanceKm ?? claim.claimedDistanceKm} km</span>
                  <span>Approved Amount: ₹{claim.approvedAmount.toFixed(2)}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-amber-500/90 italic">
              PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
            </p>
          </div>

          {/* Remarks & History */}
          {(claim.remarks || claim.rejectionReason || claim.correctionNotes) && (
            <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
              <h4 className="font-bold text-slate-400 uppercase tracking-wider">Audit Notes</h4>
              {claim.remarks && (
                <div>
                  <span className="text-slate-500 block">Engineer Remarks:</span>
                  <span className="text-slate-300">{claim.remarks}</span>
                </div>
              )}
              {claim.rejectionReason && (
                <div className="text-rose-400">
                  <span className="font-bold block">Rejection Reason:</span>
                  <span>{claim.rejectionReason}</span>
                </div>
              )}
              {claim.correctionNotes && (
                <div className="text-orange-400">
                  <span className="font-bold block">Correction Instructions:</span>
                  <span>{claim.correctionNotes}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Tabs for Coordinator / Administrator */}
          {canReviewOrApprove && !isSelfApprovalBlocked && (
            <div className="border-t border-slate-800 pt-4 space-y-4">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActionTab('DETAILS')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    actionTab === 'DETAILS'
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Actions
                </button>

                {(claim.claimStatus === 'UNDER_REVIEW' || claim.claimStatus === 'SUBMITTED') && (
                  <>
                    <button
                      onClick={() => setActionTab('APPROVE')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        actionTab === 'APPROVE'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
                      }`}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setActionTab('RETURN')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        actionTab === 'RETURN'
                          ? 'bg-orange-600 text-white'
                          : 'bg-slate-800 text-orange-400 hover:bg-slate-700'
                      }`}
                    >
                      Return
                    </button>
                    <button
                      onClick={() => setActionTab('REJECT')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        actionTab === 'REJECT'
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-800 text-rose-400 hover:bg-slate-700'
                      }`}
                    >
                      Reject
                    </button>
                  </>
                )}

                {claim.claimStatus === 'APPROVED' && canDisburse && (
                  <button
                    onClick={() => setActionTab('PAY')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      actionTab === 'PAY'
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800 text-sky-400 hover:bg-slate-700'
                    }`}
                  >
                    Disburse / Pay
                  </button>
                )}
              </div>

              {/* Action Form Panels */}
              {actionTab === 'DETAILS' && claim.claimStatus === 'SUBMITTED' && (
                <div className="p-3 bg-blue-950/30 border border-blue-900 rounded-lg flex justify-between items-center text-xs">
                  <span className="text-blue-300">Claim is submitted. Mark as under review to begin inspection:</span>
                  <button
                    onClick={handleStartReviewAction}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition"
                  >
                    Start Review
                  </button>
                </div>
              )}

              {actionTab === 'APPROVE' && (
                <div className="p-4 bg-emerald-950/20 border border-emerald-900/60 rounded-xl space-y-3 text-xs">
                  <h5 className="font-bold text-emerald-400">Approve Conveyance Claim</h5>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-400 block mb-1">Approved Distance (km)</label>
                      <input
                        type="number"
                        value={approvedDistance}
                        onChange={(e) => {
                          setApprovedDistance(e.target.value);
                          const d = parseFloat(e.target.value) || 0;
                          setCustomApprovedAmount(String(Math.round(d * claim.appliedRatePerKm * 100) / 100));
                        }}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Approved Amount (₹)</label>
                      <input
                        type="number"
                        value={customApprovedAmount}
                        onChange={(e) => setCustomApprovedAmount(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Approval Notes</label>
                    <input
                      type="text"
                      placeholder="Optional notes or adjustment justification"
                      value={approvalNotes}
                      onChange={(e) => setApprovalNotes(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    />
                  </div>
                  <button
                    onClick={handleApproveAction}
                    disabled={isSubmitting}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 font-bold text-white rounded-lg transition"
                  >
                    Confirm Approval (₹{customApprovedAmount})
                  </button>
                </div>
              )}

              {actionTab === 'RETURN' && (
                <div className="p-4 bg-orange-950/20 border border-orange-900/60 rounded-xl space-y-3 text-xs">
                  <h5 className="font-bold text-orange-400">Return Claim for Correction</h5>
                  <div>
                    <label className="text-slate-400 block mb-1">Instructions for Field Engineer *</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Please correct odometer readings or attach toll receipt"
                      value={correctionNotes}
                      onChange={(e) => setCorrectionNotes(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    />
                  </div>
                  <button
                    onClick={handleReturnAction}
                    disabled={isSubmitting}
                    className="w-full py-2 bg-orange-600 hover:bg-orange-500 font-bold text-white rounded-lg transition"
                  >
                    Return for Correction
                  </button>
                </div>
              )}

              {actionTab === 'REJECT' && (
                <div className="p-4 bg-rose-950/20 border border-rose-900/60 rounded-xl space-y-3 text-xs">
                  <h5 className="font-bold text-rose-400">Reject Conveyance Claim</h5>
                  <div>
                    <label className="text-slate-400 block mb-1">Rejection Reason *</label>
                    <textarea
                      rows={2}
                      placeholder="State reason for rejecting reimbursement claim"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    />
                  </div>
                  <button
                    onClick={handleRejectAction}
                    disabled={isSubmitting}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-500 font-bold text-white rounded-lg transition"
                  >
                    Reject Claim
                  </button>
                </div>
              )}

              {actionTab === 'PAY' && (
                <div className="p-4 bg-sky-950/20 border border-sky-900/60 rounded-xl space-y-3 text-xs">
                  <h5 className="font-bold text-sky-400">Record Financial Settlement (Payment)</h5>
                  <div>
                    <label className="text-slate-400 block mb-1">Payment Reference / UTR Number</label>
                    <input
                      type="text"
                      placeholder="e.g. UTR-20261008-883921"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    />
                  </div>
                  <button
                    onClick={handlePayAction}
                    disabled={isSubmitting}
                    className="w-full py-2 bg-sky-600 hover:bg-sky-500 font-bold text-white rounded-lg transition"
                  >
                    Mark Claim as PAID
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
