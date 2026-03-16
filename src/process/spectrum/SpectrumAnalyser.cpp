#include "SpectrumAnalyser.h"
#include <complex>
#include <iostream>
#include <deque>
#include <vector>
#include <cmath>

SpectrumAnalyser::SpectrumAnalyser(uint32_t _n, double _bandwidth)
  : n(_n), bandwidth(_bandwidth),
    decimation(_n / static_cast<uint32_t>(_bandwidth)),
    nSpectrum(_n / (_n / static_cast<uint32_t>(_bandwidth))),
    resolution(0)
{
  nfft = nSpectrum * decimation;
  dataX.resize(nfft);

  fftX = fftw_plan_dft_1d(nfft, reinterpret_cast<fftw_complex *>(dataX.data()),
                           reinterpret_cast<fftw_complex *>(dataX.data()), FFTW_FORWARD, FFTW_ESTIMATE);
}

SpectrumAnalyser::~SpectrumAnalyser()
{
  fftw_destroy_plan(fftX);
}

void SpectrumAnalyser::process(IqData *x)
{
  // load data and FFT
  const std::deque<std::complex<double>>& data = x->get_data();
  for (uint32_t i = 0; i < nfft; i++)
  {
    dataX[i] = data[i];
  }
  fftw_execute(fftX);

  // fftshift
  std::vector<std::complex<double>> fftshift(nfft);
  for (uint32_t i = 0; i < nfft; i++)
  {
    fftshift[i] = dataX[(i + nfft / 2 + 1) % nfft];
  }

  // decimate
  std::vector<std::complex<double>> spectrum;
  spectrum.reserve(nSpectrum);
  for (uint32_t i = 0; i < nfft; i += decimation)
  {
    spectrum.push_back(fftshift[i]);
  }
  x->update_spectrum(std::move(spectrum));

  // update frequency
  std::vector<double> frequency;
  frequency.reserve(nSpectrum);
  double offset = 0;
  if (decimation % 2 == 0)
  {
    offset = bandwidth / 2;
  }
  for (int32_t i = -static_cast<int32_t>(nSpectrum / 2); i < static_cast<int32_t>(nSpectrum / 2); i++)
  {
    frequency.push_back(((i * bandwidth) + offset + 204640000) / 1000);
  }
  x->update_frequency(std::move(frequency));
}
