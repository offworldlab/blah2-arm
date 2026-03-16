#include "Timing.h"
#include "data/meta/JsonSaveHelper.h"
#include <iostream>
#include <cstdlib>

#include "rapidjson/document.h"
#include "rapidjson/writer.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/filewritestream.h"

Timing::Timing(uint64_t _tStart)
  : tStart(_tStart), tNow(0), n(0), uptime(0)
{
}

void Timing::update(uint64_t _tNow, std::vector<double> _time, std::vector<std::string> _name)
{
  n = n + 1;
  tNow = _tNow;
  time = _time;
  name = _name;
  uptime = _tNow-tStart;
}

std::string Timing::to_json()
{
  rapidjson::Document document;
  document.SetObject();
  rapidjson::Document::AllocatorType &allocator = document.GetAllocator();

  document.AddMember("timestamp", tNow, allocator);
  document.AddMember("nCpi", n, allocator);
  document.AddMember("uptime_s", uptime/1000.0, allocator);
  document.AddMember("uptime_days", uptime/1000.0/60/60/24, allocator);
  rapidjson::Value name_value;
  for (size_t i = 0; i < time.size(); i++)
  {
    name_value = rapidjson::StringRef(name[i].c_str());
    document.AddMember(name_value, time[i], allocator);
  }

  rapidjson::StringBuffer strbuf;
  rapidjson::Writer<rapidjson::StringBuffer> writer(strbuf);
  writer.SetMaxDecimalPlaces(2);
  document.Accept(writer);

  return strbuf.GetString();
}

bool Timing::save(std::string _json, std::string filename)
{
  return JsonSaveHelper::append_to_array_file(_json, filename);
}
