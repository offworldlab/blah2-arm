/// @file JsonSaveHelper.h
/// @brief Utility function for appending JSON to array-based save files.
/// @details Extracts the common save-to-JSON-array-file pattern used by
/// Map, Detection, and Timing classes.

#ifndef JSON_SAVE_HELPER_H
#define JSON_SAVE_HELPER_H

#include <string>
#include <cstdio>

namespace JsonSaveHelper
{

/// @brief Append a JSON object string to a JSON array file.
/// @details Creates the file with an empty array if it doesn't exist.
/// Appends the JSON string as a new element in the array.
/// @param json JSON string to append.
/// @param filename Path of file to save.
/// @return True if save is successful.
inline bool append_to_array_file(const std::string& json, const std::string& filename)
{
  // create file if it doesn't exist
  if (FILE *fp = fopen(filename.c_str(), "r"); !fp)
  {
    if (fp = fopen(filename.c_str(), "w"); !fp)
      return false;
    fputs("[]", fp);
    fclose(fp);
  }
  else
  {
    fclose(fp);
  }

  // add the document to the file
  if (FILE *fp = fopen(filename.c_str(), "rb+"); fp)
  {
    // check if first is [
    std::fseek(fp, 0, SEEK_SET);
    if (getc(fp) != '[')
    {
      std::fclose(fp);
      return false;
    }

    // is array empty?
    bool isEmpty = false;
    if (getc(fp) == ']')
      isEmpty = true;

    // check if last is ]
    std::fseek(fp, -1, SEEK_END);
    if (getc(fp) != ']')
    {
      std::fclose(fp);
      return false;
    }

    // replace ] by ,
    fseek(fp, -1, SEEK_END);
    if (!isEmpty)
      fputc(',', fp);

    // add json element
    fwrite(json.c_str(), sizeof(char), json.length(), fp);

    // close the array
    std::fputc(']', fp);
    fclose(fp);
    return true;
  }
  return false;
}

} // namespace JsonSaveHelper

#endif
