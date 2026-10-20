/**
 * ZENTRA Field — Navigation Types
 * apps/field/src/navigation/types.ts
 */

export type ScreenName =
  | 'LOGIN'
  | 'DASHBOARD'
  | 'ASSIGNED_CASES'
  | 'CASE_DETAIL'
  | 'SCHOOL_DETAIL'
  | 'PROFILE'
  | 'HARDWARE_DIAGNOSTICS'
  | 'FIELD_VISIT';

export interface RouteState {
  currentScreen: ScreenName;
  params?: Record<string, any>;
}
