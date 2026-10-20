/**
 * ZENTRA Field — Mobile Application Root
 * apps/field/App.tsx
 *
 * Establishes the mobile local-first foundation for Field Engineers:
 * - Local WatermelonDB SQLite database initialization
 * - Session restoration from hardware secure storage
 * - Real-time network connectivity monitoring
 * - Local-first offline data querying and atomic mutations
 * - Navigation shell
 */

import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, LogBox } from 'react-native';

LogBox.ignoreAllLogs(true);
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Navigator } from './src/navigation/Navigator';

import { createAppDatabase } from './src/database/database';
import { getSecureStorage } from './src/auth/secure-storage';
import { SessionManager, type AuthenticatedSession } from './src/auth/session-manager';
import { ApiClient } from './src/api/api-client';
import { AuthApiService } from './src/api/auth-api';
import { CasesApiService } from './src/api/cases-api';
import { ReferenceApiService } from './src/api/reference-api';

import { ServiceCaseRepository } from './src/domain/repositories/service-case.repository';
import { SchoolRepository } from './src/domain/repositories/school.repository';
import { LabRepository } from './src/domain/repositories/lab.repository';
import { EquipmentRepository } from './src/domain/repositories/equipment.repository';
import { OperationQueueRepository } from './src/domain/repositories/operation-queue.repository';
import { FieldVisitRepository } from './src/domain/repositories/field-visit.repository';
import { FieldEvidenceRepository } from './src/domain/repositories/evidence.repository';
import { FieldConveyanceRepository } from './src/domain/repositories/conveyance.repository';
import { TemporaryMediaManager } from './src/hardware/camera/temporary-media-manager';
import { LocationService, ExpoLocationAdapter } from './src/hardware/location';
import { CameraService, ExpoCameraAdapter } from './src/hardware/camera';
import { PreloadManager } from './src/domain/preload/preload-manager';

import { createNetworkMonitor, type NetworkStatus } from './src/network/network-monitor';
import type { ServiceCaseModel } from './src/database/models/ServiceCaseModel';
import type { SchoolModel } from './src/database/models/SchoolModel';
import type { FieldVisitModel } from './src/database/models/FieldVisitModel';
import type { HiTechLabModel } from './src/database/models/HiTechLabModel';
import type { EquipmentModel } from './src/database/models/EquipmentModel';
import type { EvidenceModel } from './src/database/models/EvidenceModel';
import type { CaptureEvidenceCallbackParams } from './src/screens/FieldVisitScreen';
import { executeCaptureEvidence } from './src/domain/evidence/capture-evidence-handler';
import type { OperationQueueStats } from './src/domain/queue/operation-types';
import type { VisitOutcome, TravelMode } from '@zentra/types';

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('UNKNOWN');
  const [cases, setCases] = useState<ServiceCaseModel[]>([]);
  const [schools, setSchools] = useState<SchoolModel[]>([]);
  const [visits, setVisits] = useState<FieldVisitModel[]>([]);
  const [labs, setLabs] = useState<HiTechLabModel[]>([]);
  const [equipment, setEquipment] = useState<EquipmentModel[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceModel[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | undefined>(undefined);
  const [queueStats, setQueueStats] = useState<OperationQueueStats>({
    totalPending: 0,
    queuedCount: 0,
    inFlightCount: 0,
    failedCount: 0,
    acknowledgedCount: 0,
    conflictCount: 0,
  });

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);

  // Initialize singletons
  const database = useMemo(() => createAppDatabase(), []);
  const secureStorage = useMemo(() => getSecureStorage(), []);
  const sessionManager = useMemo(() => new SessionManager(secureStorage), [secureStorage]);

  const apiClient = useMemo(
    () =>
      new ApiClient({
        baseUrl: process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000/api/v1',
        sessionManager,
      }),
    [sessionManager],
  );

  const authApi = useMemo(() => new AuthApiService(apiClient), [apiClient]);
  const casesApi = useMemo(() => new CasesApiService(apiClient), [apiClient]);
  const refApi = useMemo(() => new ReferenceApiService(apiClient), [apiClient]);

  const serviceCaseRepo = useMemo(() => new ServiceCaseRepository(database), [database]);
  const schoolRepo = useMemo(() => new SchoolRepository(database), [database]);
  const labRepo = useMemo(() => new LabRepository(database), [database]);
  const equipmentRepo = useMemo(() => new EquipmentRepository(database), [database]);
  const operationQueueRepo = useMemo(() => new OperationQueueRepository(database), [database]);
  const fieldVisitRepo = useMemo(() => new FieldVisitRepository(database), [database]);
  const temporaryMediaManager = useMemo(() => new TemporaryMediaManager(), []);
  const fieldEvidenceRepo = useMemo(
    () => new FieldEvidenceRepository(database, temporaryMediaManager),
    [database, temporaryMediaManager],
  );
  const conveyanceRepo = useMemo(() => new FieldConveyanceRepository(database), [database]);
  const locationService = useMemo(() => new LocationService(new ExpoLocationAdapter()), []);
  const cameraService = useMemo(() => new CameraService(new ExpoCameraAdapter()), []);

  const preloadManager = useMemo(
    () =>
      new PreloadManager(
        casesApi,
        refApi,
        serviceCaseRepo,
        schoolRepo,
        labRepo,
        equipmentRepo,
      ),
    [casesApi, refApi, serviceCaseRepo, schoolRepo, labRepo, equipmentRepo],
  );

  const networkMonitor = useMemo(() => createNetworkMonitor(), []);

  // Refresh local cached data and queue statistics from offline database
  const refreshLocalState = async (userId?: string) => {
    try {
      const activeUserId = userId || session?.user.userId;
      if (activeUserId) {
        const localCases = await serviceCaseRepo.getAssignedCases(activeUserId);
        setCases(localCases);
        const localSchools = await database.get<SchoolModel>('schools').query().fetch();
        setSchools(localSchools);
        const localVisits = await database.get<FieldVisitModel>('field_visits').query().fetch();
        setVisits(localVisits);
        const localLabs = await database.get<HiTechLabModel>('hi_tech_labs').query().fetch();
        setLabs(localLabs);
        const localEquipment = await database.get<EquipmentModel>('equipment').query().fetch();
        setEquipment(localEquipment);
        const localEvidence = await database.get<EvidenceModel>('evidence').query().fetch();
        setEvidenceItems(localEvidence);
      } else {
        setCases([]);
        setSchools([]);
        setVisits([]);
        setLabs([]);
        setEquipment([]);
        setEvidenceItems([]);
      }

      const stats = await operationQueueRepo.getStats();
      setQueueStats(stats);
    } catch (err) {
      console.warn('[ZENTRA Field] Failed to refresh local state:', err);
    }
  };

  // App startup & recovery lifecycle
  useEffect(() => {
    let isMounted = true;

    async function initializeApp() {
      try {
        // 1. Subscribe to network connectivity
        networkMonitor.addListener((status) => {
          if (isMounted) setNetworkStatus(status);
        });

        // 2. Restore authenticated session from secure storage
        const restored = await sessionManager.restoreSession();
        if (isMounted && restored) {
          setSession(restored);
          await refreshLocalState(restored.user.userId);
        }
      } catch (err) {
        console.error('[ZENTRA Field] Boot error:', err);
      } finally {
        if (isMounted) setIsBooting(false);
      }
    }

    initializeApp();

    return () => {
      isMounted = false;
      networkMonitor.destroy();
    };
  }, []);

  // Authentication Handlers
  const handleLogin = async (credentials: { username: string; password: string }) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const response = await authApi.login(credentials);
      const activeRole = response.user.roles[0] || 'FIELD_ENGINEER';
      const expiresInMs = (response.expiresIn || 900) * 1000;
      const territoryDistrictIds = response.user.territories?.map((t) => t.districtId) || [];

      const newSession: AuthenticatedSession = {
        user: {
          userId: response.user.userId,
          username: response.user.username,
          email: (response.user as any).email || `${response.user.username}@zentra.gov.in`,
          fullName: response.user.fullName,
          activeRole,
          territoryDistrictIds,
        },
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: Date.now() + expiresInMs,
      };

      await sessionManager.saveSession(newSession);
      setSession(newSession);
      await refreshLocalState(newSession.user.userId);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (session?.refreshToken) {
        await authApi.logout(session.refreshToken).catch(() => {});
      }
    } finally {
      await sessionManager.clearSession();
      setSession(null);
      setCases([]);
      setLoginError(null);
    }
  };

  // Atomic local mutation handler
  const handleUpdateStatusLocally = async (
    caseId: string,
    targetStatus: string,
    reason?: string,
    notes?: string,
  ) => {
    await serviceCaseRepo.updateStatusLocally(caseId, targetStatus, reason, notes);
    await refreshLocalState();
  };

  // Controlled dossier preload handler
  const handleTriggerPreload = async () => {
    if (!session?.user.userId) return;
    setIsPreloading(true);
    try {
      await preloadManager.preloadAssignedDossier(session.user.userId);
      await refreshLocalState();
    } catch (err: any) {
      console.warn('[Preload] Failed to preload dossier:', err);
    } finally {
      setIsPreloading(false);
    }
  };

  // Re-queue failed local operations
  const handleRetryFailedOps = async () => {
    await operationQueueRepo.requeueFailedOperations();
    await refreshLocalState();
  };

  // Field Visit Handlers
  const handleCreateVisit = async (caseId: string, notes?: string): Promise<FieldVisitModel> => {
    if (!session?.user.userId) throw new Error('Unauthenticated session');
    const created = await fieldVisitRepo.createVisitLocally({
      serviceCaseId: caseId,
      engineerId: session.user.userId,
      notes,
    });
    await refreshLocalState();
    return created;
  };

  const handleCheckInVisit = async (visitId: string, condition?: string, notes?: string) => {
    const visit = await fieldVisitRepo.findById(visitId);
    if (!visit) throw new Error(`Visit ${visitId} not found in local database`);
    const serviceCase =
      (await serviceCaseRepo.findById(visit.serviceCaseId)) ||
      (await serviceCaseRepo.findByServerId(visit.serviceCaseId));
    const school = serviceCase
      ? (await schoolRepo.findById(serviceCase.schoolId)) ||
        (await schoolRepo.findByServerId(serviceCase.schoolId))
      : null;

    await fieldVisitRepo.checkInLocally({
      visitId,
      locationService,
      schoolLat: school?.latitude,
      schoolLon: school?.longitude,
      radiusMeters: 500,
      equipmentCondition: condition,
      notes,
    });
    await refreshLocalState();
  };

  const handleStartWorkVisit = async (
    visitId: string,
    diagnosis?: string,
    condition?: string,
    notes?: string,
  ) => {
    await fieldVisitRepo.startWorkLocally({
      visitId,
      onSiteDiagnosis: diagnosis,
      equipmentConditionObserved: condition,
      notes,
    });
    await refreshLocalState();
  };

  const handleCheckOutVisit = async (
    visitId: string,
    outcome: VisitOutcome,
    workPerformed?: string,
    diagnosis?: string,
    pendingReason?: string,
    nextVisitDate?: string,
  ) => {
    await fieldVisitRepo.checkOutLocally({
      visitId,
      visitOutcome: outcome,
      workPerformed,
      onSiteDiagnosis: diagnosis,
      pendingReasonText: pendingReason,
      targetNextVisitDate: nextVisitDate,
      locationService,
    });
    await refreshLocalState();
  };

  const handleCaptureEvidence = async (
    params: CaptureEvidenceCallbackParams,
  ): Promise<EvidenceModel> => {
    const created = await executeCaptureEvidence(
      {
        fieldVisitRepo,
        fieldEvidenceRepo,
        temporaryMediaManager,
      },
      params,
    );
    await refreshLocalState();
    return created;
  };

  const handleLogConveyanceClaim = async (params: {
    travelMode: TravelMode;
    startingOdometerKm?: number | null;
    endingOdometerKm?: number | null;
    claimedDistanceKm: number;
    remarks?: string | null;
  }) => {
    if (!session?.user.userId) throw new Error('Unauthenticated session');
    const localVisits = await database.get<FieldVisitModel>('field_visits').query().fetch();
    const completedVisit =
      localVisits.find((v) => v.status === 'COMPLETED' || v.status === 'PENDING_RETURN') ||
      localVisits[0];
    if (!completedVisit) {
      throw new Error('No completed field visit found to link conveyance claim');
    }

    await conveyanceRepo.createClaim({
      visitId: completedVisit.id,
      serviceCaseId: completedVisit.serviceCaseId,
      engineerId: session.user.userId,
      travelDate: new Date().toISOString().split('T')[0]!,
      fromLocation: 'Base Center',
      toLocation: 'School Campus',
      travelMode: params.travelMode,
      startingOdometerKm: params.startingOdometerKm,
      endingOdometerKm: params.endingOdometerKm,
      claimedDistanceKm: params.claimedDistanceKm,
      remarks: params.remarks,
      submitImmediately: false,
    });
    await refreshLocalState();
  };

  if (isBooting) {
    return (
      <View style={styles.bootContainer}>
        <ActivityIndicator size="large" color="#142B4A" />
        <Text style={styles.bootText}>Initializing ZENTRA Field...</Text>
        <Text style={styles.bootSub}>Restoring local SQLite and secure session</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <Navigator
        session={session}
        networkStatus={networkStatus}
        cases={cases}
        schools={schools}
        allVisits={visits}
        labs={labs}
        equipment={equipment}
        evidenceItems={evidenceItems}
        selectedEquipmentId={selectedEquipmentId}
        onSelectEquipment={setSelectedEquipmentId}
        onCreateVisit={handleCreateVisit}
        onCheckInVisit={handleCheckInVisit}
        onStartWorkVisit={handleStartWorkVisit}
        onCheckOutVisit={handleCheckOutVisit}
        onCaptureEvidence={handleCaptureEvidence}
        onLogConveyanceClaim={handleLogConveyanceClaim}
        locationService={locationService}
        cameraService={cameraService}
        queueStats={queueStats}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onUpdateStatusLocally={handleUpdateStatusLocally}
        onTriggerPreload={handleTriggerPreload}
        onRetryFailedOps={handleRetryFailedOps}
        isLoggingIn={isLoggingIn}
        isPreloading={isPreloading}
        loginError={loginError}
      />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  bootText: {
    marginTop: 16,
    color: '#142B4A',
    fontSize: 16,
    fontWeight: '800',
  },
  bootSub: {
    marginTop: 4,
    color: '#64748B',
    fontSize: 12,
  },
});
