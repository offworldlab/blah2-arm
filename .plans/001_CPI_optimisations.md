# CPI Optimization Plan - blah2 Performance Improvements

## Problem Statement

Deployed passive radar nodes are experiencing high CPI (Coherent Processing Interval) processing times:
- **Current CPI**: ~1000ms (after OS optimizations)
- **Clutter filter**: ~600ms (60% of total CPI) ← Primary bottleneck
- **Ambiguity filter**: ~150ms (15% of total CPI)
- **Spectrum**: ~100ms (10% of total CPI)
- **Other processing**: ~150ms (15% of total CPI)

Profiling shows the bottleneck is in DSP processing, specifically:
1. **Wiener-Hopf clutter filter** with Cholesky decomposition (600ms - main target)
2. Ambiguity function (range-Doppler processing) (150ms)
3. Spectrum analysis (100ms)
4. Multiple FFT operations across all components

## Current State

### FFTW Configuration
- **Source**: Generic Debian package (`libfftw3-dev` from apt)
- **Optimization**: None - no ARM NEON SIMD instructions
- **Planning**: `FFTW_ESTIMATE` (fast planning, slow execution)
- **Threads**: Hardcoded to 4 threads in blah2.cpp

### Compiler Configuration
- **Flags**: Only `-Wall -Werror` (CMakeLists.txt:10)
- **Optimization level**: None (default is `-O0` debug mode)
- **Architecture**: Generic (no ARM-specific flags)

### Processing Algorithm
- **Clutter filter**: Wiener-Hopf with Cholesky decomposition (O(n³))
- **Matrix size**: 410×410 complex (delayMax=400, delayMin=-10)
- **FFT operations**: 7 FFTs per CPI in clutter filter + ambiguity processing

## Proposed Changes

### Phase 1: Safe Optimizations (No Algorithm Changes)

These optimizations make the same computations faster without changing DSP output.

#### 1.1 FFTW with ARM NEON ✅ **SAFE - Priority 1**

**What**: Build FFTW from source with ARM NEON SIMD support

**Changes**:
- Dockerfile: Remove `libfftw3-dev` from apt install
- Add FFTW build from source with flags:
  - `--enable-neon` - ARM SIMD instructions
  - `--enable-threads` - Multi-threading support
  - `--enable-shared` - Shared libraries
  - `-O3 -march=native` - Compiler optimizations
- Build both single and double precision
- Update runtime stage to copy NEON-enabled libraries

**Expected gain**: 2-4x faster FFT operations

**Risk**: None - same FFT algorithm, just faster execution

**Files modified**:
- `Dockerfile` (lines 8-34, 108-113)

#### 1.2 Compiler Optimization Flags ✅ **SAFE - Priority 1**

**What**: Enable compiler optimizations for ARM architecture

**Changes**:
- CMakeLists.txt line 10: Add optimization flags:
  ```cmake
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -Werror -O3 -march=native -mtune=native")
  ```

**Flags explanation**:
- `-O3`: Maximum optimization level
- `-march=native`: Use all instructions available on target CPU (ARMv8 + NEON)
- `-mtune=native`: Tune for target CPU (Cortex-A76 on Pi 5)

**Expected gain**: 10-20% overall speedup (better code generation, auto-vectorization)

**Risk**: Very low - standard compiler optimizations

**Files modified**:
- `CMakeLists.txt` (line 10)

#### 1.3 FFTW_MEASURE Instead of FFTW_ESTIMATE ✅ **SAFE - Priority 2**

**What**: Let FFTW benchmark and optimize FFT plans at startup

**Changes**:
- `src/process/ambiguity/Ambiguity.cpp`: Change all `FFTW_ESTIMATE` → `FFTW_MEASURE`
- `src/process/clutter/WienerHopf.cpp`: Change all `FFTW_ESTIMATE` → `FFTW_MEASURE`

**Trade-off**:
- Startup time: +1-2 seconds (one-time cost)
- Runtime: 20-30% faster FFTs (every CPI)

**Expected gain**: 20-30% faster FFT operations

**Risk**: None - adds startup delay but same FFT output

**Files modified**:
- `src/process/ambiguity/Ambiguity.cpp`
- `src/process/clutter/WienerHopf.cpp`

### Phase 2: Future Optimizations (Not in Initial Implementation)

These are potential future improvements requiring more validation:

#### 2.1 Levinson-Durbin Algorithm ⚠️ **RISKY - Requires Validation**

**What**: Replace Cholesky decomposition with Levinson-Durbin recursion

**Rationale**: The autocorrelation matrix in Wiener-Hopf is Toeplitz - special structure allows O(n²) solve instead of O(n³)

**Expected gain**: 10-70x faster clutter filter (600ms → 50-100ms)

**Risk**: Medium - mathematically equivalent but different numerical properties. Needs side-by-side validation.

**Status**: Defer to future PR after Phase 1 validation

#### 2.2 Remove malloc in SDR Callback ✅ **SAFE - Future**

**What**: Pre-allocate buffers instead of malloc per sample

**Expected gain**: 5-10% reduction in overhead

**Status**: Defer to future optimization pass

## Expected Results

### Phase 1 Combined Gains

**Conservative estimate** (assuming gains don't fully stack):
- FFTW NEON: 2-3x faster FFTs
- Compiler flags: 1.15x overall speedup
- FFTW_MEASURE: 1.2x faster FFTs

**Combined FFT improvement**: ~3-4x faster for FFT-heavy components

**Per-component breakdown** (conservative 3x FFT speedup):
- Clutter filter (heavily FFT-based): 600ms → **150-200ms**
- Ambiguity filter (FFT-based): 150ms → **40-50ms**
- Spectrum (FFT-based): 100ms → **25-35ms**
- Other processing (non-FFT): 150ms → **130ms** (15% compiler gain)

**Total CPI**: ~345-415ms (down from 1000ms)

**Optimistic target** (with 4x FFT speedup):
- Clutter: 150ms
- Ambiguity: 37ms
- Spectrum: 25ms
- Other: 130ms
- **Total: ~340ms CPI** (~3x improvement)

## Implementation Plan

### Step 1: Update Dockerfile
1. Remove `libfftw3-dev` from apt dependencies
2. Add FFTW source build with NEON flags
3. Update runtime stage to copy NEON libraries

### Step 2: Update CMakeLists.txt
1. Add `-O3 -march=native -mtune=native` to compiler flags

### Step 3: Update FFT Planning
1. Change `FFTW_ESTIMATE` → `FFTW_MEASURE` in:
   - Ambiguity.cpp (all FFT plan creation)
   - WienerHopf.cpp (all FFT plan creation)

### Step 4: Build and Test
1. Build Docker image: `docker build -t blah2:cpi-opt .`
2. Run on test node with same config as production
3. Compare timing output vs baseline
4. Verify detection output unchanged

## Verification Plan

### Build Verification
```bash
# Build optimized image
docker build -t blah2:cpi-opt .

# Verify FFTW has NEON support
docker run --rm blah2:cpi-opt ldd /opt/blah2/bin/blah2 | grep fftw
# Should show /usr/local/lib/libfftw3.so (our custom build)

# Verify compiler flags
docker run --rm blah2:cpi-opt /opt/blah2/bin/blah2 --version
```

### Performance Verification
```bash
# Deploy to test node
docker-compose down
docker pull ghcr.io/offworldlabs/blah2:cpi-opt
docker-compose up -d

# Monitor CPI timing (check blah2 logs or timing endpoint)
docker logs -f blah2

# Expected results:
# - Clutter filter: 150-200ms (down from 600ms)
# - Ambiguity filter: 40-50ms (down from 150ms)
# - Spectrum: 25-35ms (down from 100ms)
# - Total CPI: 340-415ms (down from 1000ms)
```

### Correctness Verification
```bash
# Compare detection output before/after
# 1. Run baseline version, save detections for 5 minutes
# 2. Run optimized version, save detections for 5 minutes
# 3. Compare detection counts, positions, Doppler values
# 4. Outputs should be identical (within floating-point precision)
```

## Rollback Plan

If optimizations cause issues:
1. Revert to previous blah2 image version
2. Or build with `--target blah2_env` to skip optimizations
3. Git branch is separate - can abandon if needed

## Success Criteria

✅ **Total CPI < 450ms** (at minimum, down from 1000ms)
✅ **Clutter filter < 200ms** (down from 600ms)
✅ **Ambiguity filter < 60ms** (down from 150ms)
✅ **Spectrum < 40ms** (down from 100ms)
✅ Detection output unchanged from baseline (within FP precision)
✅ No numerical instability or crashes
✅ Build completes successfully

**Stretch goal**: Total CPI < 350ms (3x improvement)

## Notes

- All Phase 1 changes are **safe** - they don't modify DSP algorithms
- Output should be identical to baseline (within floating-point precision ~10⁻¹⁵)
- These are standard performance optimizations used in production DSP systems
- Levinson-Durbin (Phase 2) is deferred - requires more validation

## Files to Modify

**Phase 1 (This PR)**:
1. `Dockerfile` - FFTW with NEON
2. `CMakeLists.txt` - Compiler flags
3. `src/process/ambiguity/Ambiguity.cpp` - FFTW_MEASURE
4. `src/process/clutter/WienerHopf.cpp` - FFTW_MEASURE

**Phase 2 (Future)**:
- Levinson-Durbin implementation (new file or modify WienerHopf.cpp)
- SDR callback buffer management
- FFTW threads tuning
