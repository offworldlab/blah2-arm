#include "Capture.h"
#include "rspduo/RspDuo.h"
#include <iostream>
#include <thread>
#include <chrono>
#include <httplib.h>

// constants
const std::string Capture::VALID_TYPE[1] = {"RspDuo"};

// constructor
Capture::Capture(std::string _type, uint32_t _fs, uint32_t _fc, std::string _path)
{
  type = _type;
  fs = _fs;
  fc = _fc;
  path = _path;
  replay = false;
  saveIq = false;
}

void Capture::process(IqData *buffer1, IqData *buffer2, c4::yml::NodeRef config,
  std::string ip_capture, uint16_t port_capture, bool verbose)
{
  std::cout << "Setting up device " + type << std::endl;

  device = factory_source(type, config, verbose);

  // capture status thread
  std::thread t1([&]{
    while (true)
    {
      httplib::Client cli("http://" + ip_capture + ":" 
        + std::to_string(port_capture));
      httplib::Result res = cli.Get("/capture");

      // if capture status changed
      if ((res->body == "true") != saveIq)
      {
        saveIq = res->body == "true";
        if (saveIq)
        {
          device->open_file();
        }
        else
        {
          device->close_file();
        }
      }
      sleep(1);
    }
  });

  // peak dBFS reporting thread: independent of the capture-status thread
  // above (one thread per concern) — reports live per-tuner signal level
  // to blah2_api every second, no on-change/heartbeat logic needed since
  // it's a continuous value, not a rare state transition
  std::thread tPeakStatus([&]{
    while (true)
    {
      httplib::Client cli("http://" + ip_capture + ":"
        + std::to_string(port_capture));

      double dbfsA = 0, dbfsB = 0;
      if (device->get_peak_dbfs(dbfsA, dbfsB))
      {
        auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch()).count();
        std::string body = std::to_string(dbfsA) + ","
          + std::to_string(dbfsB) + "," + std::to_string(now);
        cli.Post("/capture/rf-status", body, "text/plain");
      }

      sleep(1);
    }
  });

  if (!replay)
  {
    device->start();
    device->process(buffer1, buffer2);
  }
  else
  {
    device->replay(buffer1, buffer2, file, loop);
  }
  t1.join();
  tPeakStatus.join();
}

std::unique_ptr<Source> Capture::factory_source(const std::string& type, c4::yml::NodeRef config, bool verbose)
{
    // SDRplay RSPduo
    if (type == VALID_TYPE[0])
    {
        int agcSetPoint = 0, bandwidthNumber = 0, gainReductionA = 0, gainReductionB = 0, lnaState = 0;
        bool dabNotch = false, rfNotch = false;
        config["agcSetPoint"] >> agcSetPoint;
        config["bandwidthNumber"] >> bandwidthNumber;
        config["gainReduction"][0] >> gainReductionA;
        config["gainReduction"][1] >> gainReductionB;
        config["lnaState"] >> lnaState;
        config["dabNotch"] >> dabNotch;
        config["rfNotch"] >> rfNotch;
        return std::make_unique<RspDuo>(type, fc, fs, path, &saveIq,
          agcSetPoint, bandwidthNumber, gainReductionA, gainReductionB, lnaState,
          dabNotch, rfNotch, verbose);
    }

    // handle unknown type
    std::cerr << "Error: Source type does not exist." << std::endl;
    return nullptr;
}

void Capture::set_replay(bool _loop, std::string _file)
{
  replay = true;
  loop = _loop;
  file = _file;
}
