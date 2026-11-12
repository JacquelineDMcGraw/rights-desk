cmake_minimum_required(VERSION 3.22.1)
project(rights_desk_whisper LANGUAGES C CXX)

include(FetchContent)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_ACCELERATE OFF CACHE BOOL "" FORCE)

FetchContent_Declare(whisper
    URL https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/2eeeba56e9edd762b4b38467bab96c2517163158
    URL_HASH SHA256=089b898aa83b24a8321e0fd554eeb0967fb03dd687e27f6374c72d3363b5b429)
FetchContent_MakeAvailable(whisper)

add_library(rights_desk_whisper SHARED transcribe.cpp)
target_compile_features(rights_desk_whisper PRIVATE cxx_std_17)
target_link_libraries(rights_desk_whisper PRIVATE whisper)
if(ANDROID)
    target_link_options(rights_desk_whisper PRIVATE -Wl,-z,max-page-size=16384)
endif()
