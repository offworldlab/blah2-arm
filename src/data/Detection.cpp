#include "Detection.h"
#include "data/meta/Constants.h"
#include "data/meta/JsonSaveHelper.h"
#include <iostream>
#include <cstdlib>
#include <chrono>

#include "rapidjson/document.h"
#include "rapidjson/writer.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/filewritestream.h"

Detection::Detection(std::vector<double> _delay, std::vector<double> _doppler, std::vector<double> _snr)
  : delay(std::move(_delay)), doppler(std::move(_doppler)), snr(std::move(_snr))
{
}

Detection::Detection(double _delay, double _doppler, double _snr)
  : delay({_delay}), doppler({_doppler}), snr({_snr})
{
}

std::vector<double> Detection::get_delay()
{
  return delay;
}

std::vector<double> Detection::get_doppler()
{
  return doppler;
}

std::vector<double> Detection::get_snr()
{
  return snr;
}

size_t Detection::get_nDetections()
{
  return delay.size();
}

std::string Detection::to_json(uint64_t timestamp)
{
  rapidjson::Document document;
  document.SetObject();
  rapidjson::Document::AllocatorType &allocator = document.GetAllocator();

  // store delay array
  rapidjson::Value arrayDelay(rapidjson::kArrayType);
  for (size_t i = 0; i < get_nDetections(); i++)
  {
    arrayDelay.PushBack(delay[i], allocator);
  }

  // store Doppler array
  rapidjson::Value arrayDoppler(rapidjson::kArrayType);
  for (size_t i = 0; i < get_nDetections(); i++)
  {
    arrayDoppler.PushBack(doppler[i], allocator);
  }

  // store snr array
  rapidjson::Value arraySnr(rapidjson::kArrayType);
  for (size_t i = 0; i < get_nDetections(); i++)
  {
    arraySnr.PushBack(snr[i], allocator);
  }

  document.AddMember("timestamp", timestamp, allocator);
  document.AddMember("delay", arrayDelay, allocator);
  document.AddMember("doppler", arrayDoppler, allocator);
  document.AddMember("snr", arraySnr, allocator);
  
  rapidjson::StringBuffer strbuf;
  rapidjson::Writer<rapidjson::StringBuffer> writer(strbuf);
  writer.SetMaxDecimalPlaces(2);
  document.Accept(writer);

  return strbuf.GetString();
}

std::string Detection::delay_bin_to_km(std::string json, uint32_t fs)
{
  rapidjson::Document document;
  document.SetObject();
  rapidjson::Document::AllocatorType &allocator = document.GetAllocator();
  document.Parse(json.c_str());

  document["delay"].Clear();
  for (size_t i = 0; i < delay.size(); i++)
  {
    document["delay"].PushBack(1.0*delay[i]*(Constants::c/(double)fs)/1000, allocator);
  }

  rapidjson::StringBuffer strbuf;
  rapidjson::Writer<rapidjson::StringBuffer> writer(strbuf);
  writer.SetMaxDecimalPlaces(2);
  document.Accept(writer);

  return strbuf.GetString();
}

bool Detection::save(std::string _json, std::string filename)
{
  return JsonSaveHelper::append_to_array_file(_json, filename);
}
