/// @file TuneState.h
/// @brief Cross-thread handoff for live retune events.
/// @details Set by Capture's retune-poll thread after RspDuo::retune()
/// applies a changed center frequency. Consumed once per CPI by blah2.cpp's
/// processing loop to refresh Tracker::lambda and clear stale tracks.
/// Gain-only retunes never touch this — same geometry, tracks remain valid.
/// @author 30hours

#ifndef TUNESTATE_H
#define TUNESTATE_H

#include <atomic>
#include <stdint.h>

struct TuneState
{
  /// @brief True if fc changed since the processing loop last consumed it.
  std::atomic<bool> fcChanged{false};

  /// @brief The center frequency (Hz) currently applied to the device.
  std::atomic<uint32_t> currentFc{0};
};

extern TuneState g_tuneState;

#endif
