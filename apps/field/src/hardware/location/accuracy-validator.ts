/**
 * ZENTRA Field — GPS Accuracy Validator
 * apps/field/src/hardware/location/accuracy-validator.ts
 *
 * Validates GPS accuracy against configurable thresholds (default: ≤ 50m).
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 accuracy verification only.
 * Does NOT create field visits, triggers no check-in/out, and executes no case transitions.
 */

import {
  type AccuracyValidationResult,
  type LocationSample,
  DEFAULT_LOCATION_CONFIG,
} from './location.types';

export class AccuracyValidator {
  /**
   * Evaluates if a given location sample meets the GPS accuracy threshold.
   *
   * @param sample The location sample to validate
   * @param maxThresholdMeters Optional threshold override; defaults to DEFAULT_LOCATION_CONFIG.maxAccuracyThresholdMeters (50m)
   * @returns AccuracyValidationResult ('VALID_ACCURACY' or 'INSUFFICIENT_ACCURACY')
   */
  static validate(
    sample: LocationSample | null | undefined,
    maxThresholdMeters: number = DEFAULT_LOCATION_CONFIG.maxAccuracyThresholdMeters,
  ): AccuracyValidationResult {
    if (!sample) {
      return 'LOCATION_UNAVAILABLE';
    }

    if (
      typeof sample.accuracyMeters !== 'number' ||
      !Number.isFinite(sample.accuracyMeters) ||
      sample.accuracyMeters < 0
    ) {
      return 'LOCATION_ERROR';
    }

    if (sample.accuracyMeters <= maxThresholdMeters) {
      return 'VALID_ACCURACY';
    }

    return 'INSUFFICIENT_ACCURACY';
  }

  /**
   * Helper checking boolean satisfaction of the threshold.
   */
  static isValid(
    sample: LocationSample | null | undefined,
    maxThresholdMeters: number = DEFAULT_LOCATION_CONFIG.maxAccuracyThresholdMeters,
  ): boolean {
    return this.validate(sample, maxThresholdMeters) === 'VALID_ACCURACY';
  }
}
