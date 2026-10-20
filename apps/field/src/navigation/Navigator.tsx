/**
 * ZENTRA Field — Navigation Router & Shell
 * apps/field/src/navigation/Navigator.tsx
 *
 * Implements enterprise field-optimized screen navigation:
 * - Switches between Auth Stack (Login) and Main Stack
 * - Reusable TopHeader with real-time connectivity status & active role
 * - Reusable BottomTabBar for quick thumb navigation
 * - Stack routing into Case Detail, School Dossier, and Field Visit
 * - Enterprise Light Theme integration
 */

import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { RouteState, ScreenName } from './types';
import type { AuthenticatedSession } from '../auth/session-manager';
import type { NetworkStatus } from '../network/network-monitor';
import type { ServiceCaseModel } from '../database/models/ServiceCaseModel';
import type { SchoolModel } from '../database/models/SchoolModel';
import type { OperationQueueStats } from '../domain/queue/operation-types';

import { LoginScreen } from '../screens/LoginScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { AssignedCasesScreen } from '../screens/AssignedCasesScreen';
import { CaseDetailScreen } from '../screens/CaseDetailScreen';
import { SchoolDetailScreen } from '../screens/SchoolDetailScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { HardwareDiagnosticsScreen } from '../screens/HardwareDiagnosticsScreen';
import { FieldVisitScreen, type CaptureEvidenceCallbackParams } from '../screens/FieldVisitScreen';
import { LocationService, ExpoLocationAdapter } from '../hardware/location';
import { CameraService, ExpoCameraAdapter } from '../hardware/camera';

import type { FieldVisitModel } from '../database/models/FieldVisitModel';
import type { HiTechLabModel } from '../database/models/HiTechLabModel';
import type { EquipmentModel } from '../database/models/EquipmentModel';
import type { EvidenceModel } from '../database/models/EvidenceModel';
import type { VisitOutcome, TravelMode } from '@zentra/types';
import { colors } from '../theme';
import { TopHeader, BottomTabBar } from '../components/ui';

interface NavigatorProps {
  session: AuthenticatedSession | null;
  networkStatus: NetworkStatus;
  cases: ServiceCaseModel[];
  schools: SchoolModel[];
  queueStats: OperationQueueStats;
  allVisits?: FieldVisitModel[];
  labs?: HiTechLabModel[];
  equipment?: EquipmentModel[];
  evidenceItems?: EvidenceModel[];
  selectedEquipmentId?: string;
  onSelectEquipment?: (equipmentId: string) => void;
  onCreateVisit?: (caseId: string, notes?: string) => Promise<FieldVisitModel>;
  onCheckInVisit?: (visitId: string, condition?: string, notes?: string) => Promise<void>;
  onStartWorkVisit?: (visitId: string, diagnosis?: string, condition?: string, notes?: string) => Promise<void>;
  onCheckOutVisit?: (
    visitId: string,
    outcome: VisitOutcome,
    workPerformed?: string,
    diagnosis?: string,
    pendingReason?: string,
    nextVisitDate?: string,
  ) => Promise<void>;
  onCaptureEvidence?: (params: CaptureEvidenceCallbackParams) => Promise<EvidenceModel>;
  onLogConveyanceClaim?: (params: {
    travelMode: TravelMode;
    startingOdometerKm?: number | null;
    endingOdometerKm?: number | null;
    claimedDistanceKm: number;
    remarks?: string | null;
  }) => Promise<void>;
  onLogin: (credentials: { username: string; password: string }) => Promise<void>;
  onLogout: () => Promise<void>;
  onUpdateStatusLocally: (caseId: string, targetStatus: string, reason?: string, notes?: string) => Promise<void>;
  onTriggerPreload: () => Promise<void>;
  onRetryFailedOps: () => Promise<void>;
  locationService?: LocationService;
  cameraService?: CameraService;
  isLoggingIn: boolean;
  isPreloading: boolean;
  loginError?: string | null;
}

export function Navigator({
  session,
  networkStatus,
  cases,
  schools,
  queueStats,
  allVisits,
  labs,
  equipment,
  evidenceItems,
  selectedEquipmentId,
  onSelectEquipment,
  onCreateVisit,
  onCheckInVisit,
  onStartWorkVisit,
  onCheckOutVisit,
  onCaptureEvidence,
  onLogConveyanceClaim,
  onLogin,
  onLogout,
  onUpdateStatusLocally,
  onTriggerPreload,
  onRetryFailedOps,
  locationService,
  cameraService,
  isLoggingIn,
  isPreloading,
  loginError,
}: NavigatorProps) {
  const [route, setRoute] = useState<RouteState>({ currentScreen: 'DASHBOARD' });

  const activeLocService = React.useMemo(
    () => locationService || new LocationService(new ExpoLocationAdapter()),
    [locationService],
  );
  const activeCamService = React.useMemo(
    () => cameraService || new CameraService(new ExpoCameraAdapter()),
    [cameraService],
  );

  // 1. If unauthenticated, lock into Login Screen
  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <LoginScreen onLogin={onLogin} isLoading={isLoggingIn} errorMessage={loginError} />
      </SafeAreaView>
    );
  }

  const navigateTo = (screen: ScreenName, params?: Record<string, any>) => {
    setRoute({ currentScreen: screen, params });
  };


  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Top Header with Safe Area Inset Management */}
      <TopHeader
        activeRole={session.user.activeRole}
        networkStatus={networkStatus}
        pendingCount={queueStats.totalPending}
      />

      {/* Screen Body */}
      <View style={styles.body}>
        {route.currentScreen === 'DASHBOARD' && (
          <DashboardScreen
            user={session.user}
            networkStatus={networkStatus}
            assignedCasesCount={cases.length}
            queueStats={queueStats}
            onNavigateToCases={() => navigateTo('ASSIGNED_CASES')}
            onNavigateToProfile={() => navigateTo('PROFILE')}
            onTriggerPreload={onTriggerPreload}
            isPreloading={isPreloading}
            cases={cases}
            schools={schools}
            allVisits={allVisits}
            labs={labs}
            equipment={equipment}
            onNavigateToDiagnostics={() => navigateTo('HARDWARE_DIAGNOSTICS')}
            onSelectCase={(caseId) => navigateTo('CASE_DETAIL', { caseId })}
          />
        )}

        {route.currentScreen === 'ASSIGNED_CASES' && (
          <AssignedCasesScreen
            cases={cases}
            onSelectCase={(caseId) => navigateTo('CASE_DETAIL', { caseId })}
            onBack={() => navigateTo('DASHBOARD')}
          />
        )}

        {route.currentScreen === 'CASE_DETAIL' && (
          (() => {
            const currentCase = cases.find((c) => c.id === route.params?.caseId || c.serverId === route.params?.caseId);
            if (!currentCase) {
              return null;
            }
            const caseVisits = allVisits?.filter(
              (v) => v.serviceCaseId === currentCase.serverId || v.serviceCaseId === currentCase.id,
            ) || [];
            const activeVisit =
              caseVisits.find((v) => v.status !== 'COMPLETED' && v.status !== 'ABORTED') ||
              (caseVisits.length > 0 ? caseVisits[caseVisits.length - 1] : undefined);

            return (
              <CaseDetailScreen
                serviceCase={currentCase}
                activeVisit={activeVisit}
                visitCount={caseVisits.length}
                onNavigateToVisit={(caseId) => navigateTo('FIELD_VISIT', { caseId })}
                onUpdateStatusLocally={(status, reason, notes) =>
                  onUpdateStatusLocally(currentCase.id, status, reason, notes)
                }
                onViewSchool={(schoolId) => navigateTo('SCHOOL_DETAIL', { schoolId })}
                onBack={() => navigateTo('ASSIGNED_CASES')}
              />
            );
          })()
        )}

        {route.currentScreen === 'FIELD_VISIT' && (
          (() => {
            const currentCase = cases.find((c) => c.id === route.params?.caseId || c.serverId === route.params?.caseId);
            if (!currentCase) {
              return null;
            }
            const caseVisits = allVisits?.filter(
              (v) => v.serviceCaseId === currentCase.serverId || v.serviceCaseId === currentCase.id,
            ) || [];
            const paramVisitId = route.params?.visitId as string | undefined;
            const activeVisit =
              (paramVisitId
                ? caseVisits.find((v) => v.id === paramVisitId || v.serverId === paramVisitId)
                : undefined) ||
              caseVisits.find((v) => v.status !== 'COMPLETED' && v.status !== 'ABORTED') ||
              (caseVisits.length > 0 ? caseVisits[caseVisits.length - 1] : null);

            const school = schools.find((s) => s.serverId === currentCase.schoolId || s.id === currentCase.schoolId) || null;
            const caseLabs = school
              ? (labs?.filter((l) => l.schoolId === school.serverId || l.schoolId === school.id) || [])
              : [];
            const relevantLabIds = new Set(caseLabs.map((l) => l.serverId).concat(caseLabs.map((l) => l.id)));
            const labEquipment = equipment?.filter((e) => relevantLabIds.has(e.labId)) || [];
            const visitEvidence = evidenceItems?.filter(
              (e) => e.visitId === activeVisit?.id || e.visitId === activeVisit?.serverId,
            ) || [];

            return (
              <FieldVisitScreen
                serviceCase={currentCase}
                school={school}
                activeVisit={activeVisit}
                visits={caseVisits}
                locationService={activeLocService}
                cameraService={activeCamService}
                evidenceItems={visitEvidence}
                labEquipment={labEquipment}
                selectedEquipmentId={selectedEquipmentId ?? undefined}
                onSelectEquipment={onSelectEquipment}
                onCaptureEvidence={onCaptureEvidence}
                onCheckIn={onCheckInVisit || (async () => {})}
                onStartWork={onStartWorkVisit || (async () => {})}
                onCheckOut={onCheckOutVisit || (async () => {})}
                onCreateVisit={async (notes?: string) => {
                  if (onCreateVisit) {
                    await onCreateVisit(currentCase.id, notes);
                  }
                }}
                onLogConveyanceClaim={onLogConveyanceClaim}
                onBack={() => navigateTo('CASE_DETAIL', { caseId: currentCase.id })}
              />
            );
          })()
        )}

        {route.currentScreen === 'SCHOOL_DETAIL' && (
          (() => {
            const school = schools.find((s) => s.serverId === route.params?.schoolId || s.id === route.params?.schoolId) || null;
            const schoolLabs = school
              ? (labs?.filter((l) => l.schoolId === school.serverId || l.schoolId === school.id) || [])
              : [];
            const eqByLab: Record<string, EquipmentModel[]> = {};
            if (equipment) {
              for (const eq of equipment) {
                if (!eqByLab[eq.labId]) {
                  eqByLab[eq.labId] = [];
                }
                eqByLab[eq.labId]!.push(eq);
              }
            }
            return (
              <SchoolDetailScreen
                school={school}
                labs={schoolLabs}
                equipmentByLab={eqByLab}
                onBack={() => navigateTo('ASSIGNED_CASES')}
              />
            );
          })()
        )}

        {route.currentScreen === 'PROFILE' && (
          <ProfileScreen
            user={session.user}
            queueStats={queueStats}
            onLogout={onLogout}
            onRetryFailedOps={onRetryFailedOps}
            onNavigateToDiagnostics={() => navigateTo('HARDWARE_DIAGNOSTICS')}
          />
        )}

        {route.currentScreen === 'HARDWARE_DIAGNOSTICS' && (
          <HardwareDiagnosticsScreen
            locationService={activeLocService}
            cameraService={activeCamService}
            onBack={() => navigateTo('PROFILE')}
          />
        )}
      </View>

      {/* Enterprise Bottom Tab Bar */}
      <BottomTabBar
        currentScreen={route.currentScreen}
        assignedCount={cases.length}
        onNavigate={navigateTo}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
});
