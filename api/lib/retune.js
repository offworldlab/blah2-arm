// Bounds mirror RspDuo.cpp's MIN/MAX_GAIN_REDUCTION_NR and MAX_FREQUENCY_NR
// (src/capture/rspduo/RspDuo.cpp) — keep in sync if those ever change.
const MIN_GAIN_REDUCTION = 20;
const MAX_GAIN_REDUCTION = 59;
const MIN_FC = 1;
const MAX_FC = 2000000000;

/**
 * Validate a retune request.
 * @param {number} fc Center frequency (Hz).
 * @param {number} gainReductionA Gain reduction for tuner A (dB).
 * @param {number} gainReductionB Gain reduction for tuner B (dB).
 * @returns {string|null} Error message, or null if valid.
 */
function validate(fc, gainReductionA, gainReductionB) {
  if (!Number.isFinite(fc) || fc < MIN_FC || fc > MAX_FC) {
    return 'fc out of range (' + MIN_FC + '-' + MAX_FC + ' Hz)';
  }
  for (const g of [gainReductionA, gainReductionB]) {
    if (!Number.isInteger(g) || g < MIN_GAIN_REDUCTION || g > MAX_GAIN_REDUCTION) {
      return 'gainReduction out of range (' + MIN_GAIN_REDUCTION + '-'
        + MAX_GAIN_REDUCTION + ' dB)';
    }
  }
  return null;
}

module.exports = {
  validate,
  MIN_GAIN_REDUCTION,
  MAX_GAIN_REDUCTION,
  MIN_FC,
  MAX_FC,
};
