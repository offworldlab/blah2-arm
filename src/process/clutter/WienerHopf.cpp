#include "WienerHopf.h"
#include <complex>
#include <iostream>
#include <vector>

WienerHopf::WienerHopf(int32_t _delayMin, int32_t _delayMax, uint32_t _nSamples)
  : delayMin(_delayMin), delayMax(_delayMax),
    nBins(_delayMax - _delayMin), nSamples(_nSamples), success(false),
    dataX(_nSamples), dataY(_nSamples), dataOutX(_nSamples), dataOutY(_nSamples),
    dataA(_nSamples), dataB(_nSamples),
    filtX(_delayMax - _delayMin + _nSamples + 1),
    filtW(_delayMax - _delayMin + _nSamples + 1),
    filt(_delayMax - _delayMin + _nSamples + 1),
    A(_delayMax - _delayMin, _delayMax - _delayMin),
    a(_delayMax - _delayMin), b(_delayMax - _delayMin), w(_delayMax - _delayMin)
{
  fftX = fftw_plan_dft_1d(nSamples, reinterpret_cast<fftw_complex *>(dataX.data()),
                          reinterpret_cast<fftw_complex *>(dataOutX.data()), FFTW_FORWARD, FFTW_ESTIMATE);
  fftY = fftw_plan_dft_1d(nSamples, reinterpret_cast<fftw_complex *>(dataY.data()),
                          reinterpret_cast<fftw_complex *>(dataOutY.data()), FFTW_FORWARD, FFTW_ESTIMATE);
  fftA = fftw_plan_dft_1d(nSamples, reinterpret_cast<fftw_complex *>(dataA.data()),
                          reinterpret_cast<fftw_complex *>(dataA.data()), FFTW_BACKWARD, FFTW_ESTIMATE);
  fftB = fftw_plan_dft_1d(nSamples, reinterpret_cast<fftw_complex *>(dataB.data()),
                          reinterpret_cast<fftw_complex *>(dataB.data()), FFTW_BACKWARD, FFTW_ESTIMATE);
  fftFiltX = fftw_plan_dft_1d(nBins + nSamples + 1, reinterpret_cast<fftw_complex *>(filtX.data()),
                              reinterpret_cast<fftw_complex *>(filtX.data()), FFTW_FORWARD, FFTW_ESTIMATE);
  fftFiltW = fftw_plan_dft_1d(nBins + nSamples + 1, reinterpret_cast<fftw_complex *>(filtW.data()),
                              reinterpret_cast<fftw_complex *>(filtW.data()), FFTW_FORWARD, FFTW_ESTIMATE);
  fftFilt = fftw_plan_dft_1d(nBins + nSamples + 1, reinterpret_cast<fftw_complex *>(filt.data()),
                             reinterpret_cast<fftw_complex *>(filt.data()), FFTW_BACKWARD, FFTW_ESTIMATE);
}

WienerHopf::~WienerHopf()
{
  fftw_destroy_plan(fftX);
  fftw_destroy_plan(fftY);
  fftw_destroy_plan(fftA);
  fftw_destroy_plan(fftB);
  fftw_destroy_plan(fftFiltX);
  fftw_destroy_plan(fftFiltW);
  fftw_destroy_plan(fftFilt);
}

bool WienerHopf::process(IqData *x, IqData *y)
{
  uint32_t i, j;
  xData = x->get_data();
  yData = y->get_data();

  // change deque to std::complex
  for (i = 0; i < nSamples; i++)
  {
    dataX[i] = xData[(((i - delayMin) % nSamples) + nSamples) % nSamples];
    dataY[i] = yData[i];
  }

  // pre-compute FFT of signals
  fftw_execute(fftX);
  fftw_execute(fftY);

  // auto-correlation matrix A
  for (i = 0; i < nSamples; i++)
  {
    dataA[i] = (dataOutX[i] * std::conj(dataOutX[i]));
  }
  fftw_execute(fftA);
  for (i = 0; i < nBins; i++)
  {
    a[i] = std::conj(dataA[i]) / static_cast<double>(nSamples);
  }
  A = arma::toeplitz(a);

  // conjugate upper diagonal as arma does not
  for (i = 0; i < nBins; i++)
  {
    for (j = 0; j < nBins; j++)
    {
      if (i > j)
      {
        A(i, j) = std::conj(A(i, j));
      }
    }
  }

  // cross-correlation vector b
  for (i = 0; i < nSamples; i++)
  {
    dataB[i] = (dataOutY[i] * std::conj(dataOutX[i]));
  }
  fftw_execute(fftB);
  for (i = 0; i < nBins; i++)
  {
    b[i] = dataB[i] / static_cast<double>(nSamples);
  }

  // compute weights
  success = arma::chol(A, A);
  if (!success)
  {
    std::cerr << "Chol decomposition failed, skip clutter filter" << std::endl;
    return false;
  }
  success = arma::solve(w, arma::trimatu(A), arma::solve(arma::trimatl(arma::trans(A)), b));
  if (!success)
  {
    std::cerr << "Solve failed, skip clutter filter" << std::endl;
    return false;
  }

  // assign and pad x
  for (i = 0; i < nSamples; i++)
  {
    filtX[i] = dataX[i];
  }
  for (i = nSamples; i < nBins + nSamples + 1; i++)
  {
    filtX[i] = {0, 0};
  }

  // assign and pad w
  for (i = 0; i < nBins; i++)
  {
    filtW[i] = w[i];
  }
  for (i = nBins; i < nBins + nSamples + 1; i++)
  {
    filtW[i] = {0, 0};
  }

  // compute fft
  fftw_execute(fftFiltX);
  fftw_execute(fftFiltW);

  // compute convolution/filter
  for (i = 0; i < nBins + nSamples + 1; i++)
  {
    filt[i] = (filtW[i] * filtX[i]);
  }
  fftw_execute(fftFilt);

  // update surveillance signal
  y->clear();
  for (i = 0; i < nSamples; i++)
  {
    y->push_back(dataY[i] - (filt[i] / static_cast<double>(nBins + nSamples + 1)));
  }

  return true;
}
