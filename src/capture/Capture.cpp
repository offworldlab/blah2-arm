#include "Capture.h"
#include "rspduo/RspDuo.h"
#include "process/utility/TuneState.h"
#include <iostream>
#include <thread>
#include <chrono>
#include <cstdio>
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

  // retune poll thread: applies live fc/gain changes requested via the API
  // and reports per-tuner RF overload state back to it
  std::thread tRetune([&]{
    bool lastOverloadA = false;
    bool lastOverloadB = false;
    bool overloadReported = false;
    auto lastRfStatusPost = std::chrono::steady_clock::now();

    while (true)
    {
      httplib::Client cli("http://" + ip_capture + ":"
        + std::to_string(port_capture));

      // check for a pending retune request
      httplib::Result res = cli.Get("/capture/retune");
      if (res && res->status == 200)
      {
        long generation = 0;
        unsigned int newFc = 0;
        int newGainA = 0, newGainB = 0, newLnaState = 0;
        if (sscanf(res->body.c_str(), "%ld,%u,%d,%d,%d",
              &generation, &newFc, &newGainA, &newGainB, &newLnaState) == 5
            && generation > 0 && generation > lastAppliedRetuneGeneration)
        {
          bool fcChanged = false;
          if (device->retune(newFc, newGainA, newGainB, newLnaState, fcChanged))
          {
            lastAppliedRetuneGeneration = generation;
            fc = newFc;
            if (fcChanged)
            {
              g_tuneState.currentFc.store(newFc);
              g_tuneState.fcChanged.store(true);
            }
            auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
              std::chrono::system_clock::now().time_since_epoch()).count();
            std::string ack = std::to_string(generation) + ","
              + std::to_string(newFc) + ","
              + std::to_string(newGainA) + ","
              + std::to_string(newGainB) + ","
              + std::to_string(newLnaState) + ","
              + std::to_string(now);
            cli.Post("/capture/retune/ack", ack, "text/plain");
          }
          else
          {
            std::cerr << "[Capture] Retune generation " << generation
              << " rejected" << std::endl;
          }
        }
      }

      // report overload state on change, with a periodic heartbeat so the
      // consumer can detect staleness
      bool overloadA = false, overloadB = false;
      if (device->get_overload(overloadA, overloadB))
      {
        auto sinceLastPost = std::chrono::steady_clock::now() - lastRfStatusPost;
        if (!overloadReported || overloadA != lastOverloadA
            || overloadB != lastOverloadB
            || sinceLastPost > std::chrono::seconds(2))
        {
          auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
          std::string body = std::string(overloadA ? "1" : "0") + ","
            + (overloadB ? "1" : "0") + "," + std::to_string(now);
          if (cli.Post("/capture/rf-status", body, "text/plain"))
          {
            lastOverloadA = overloadA;
            lastOverloadB = overloadB;
            overloadReported = true;
            lastRfStatusPost = std::chrono::steady_clock::now();
          }
        }
      }

      std::this_thread::sleep_for(std::chrono::milliseconds(250));
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
  tRetune.join();
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
