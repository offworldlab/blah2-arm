// Bounds mirror RspDuo.cpp's MIN/MAX_GAIN_REDUCTION_NR, MIN/MAX_LNA_STATE_NR
// and MAX_FREQUENCY_NR (src/capture/rspduo/RspDuo.cpp) — keep in sync if
// those ever change.
const MIN_GAIN_REDUCTION = 20;
const MAX_GAIN_REDUCTION = 59;
const MIN_LNA_STATE = 1;
const MAX_LNA_STATE = 9;
const MIN_FC = 1;
const MAX_FC = 2000000000;

/**
 * Validate a retune request.
 * @param {number} fc Center frequency (Hz).
 * @param {number} gainReductionA Gain reduction for tuner A (dB).
 * @param {number} gainReductionB Gain reduction for tuner B (dB).
 * @param {number} lnaState LNA state (shared across both tuners), 1-9.
 * @returns {string|null} Error message, or null if valid.
 */
function validate(fc, gainReductionA, gainReductionB, lnaState) {
  if (!Number.isFinite(fc) || fc < MIN_FC || fc > MAX_FC) {
    return 'fc out of range (' + MIN_FC + '-' + MAX_FC + ' Hz)';
  }
  for (const g of [gainReductionA, gainReductionB]) {
    if (!Number.isInteger(g) || g < MIN_GAIN_REDUCTION || g > MAX_GAIN_REDUCTION) {
      return 'gainReduction out of range (' + MIN_GAIN_REDUCTION + '-'
        + MAX_GAIN_REDUCTION + ' dB)';
    }
  }
  if (!Number.isInteger(lnaState) || lnaState < MIN_LNA_STATE || lnaState > MAX_LNA_STATE) {
    return 'lnaState out of range (' + MIN_LNA_STATE + '-' + MAX_LNA_STATE + ')';
  }
  return null;
}

module.exports = {
  validate,
  MIN_GAIN_REDUCTION,
  MAX_GAIN_REDUCTION,
  MIN_LNA_STATE,
  MAX_LNA_STATE,
  MIN_FC,
  MAX_FC,
};
