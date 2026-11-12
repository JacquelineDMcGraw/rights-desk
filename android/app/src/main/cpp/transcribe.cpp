#include <jni.h>
#include <whisper.h>

#include <algorithm>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {
std::once_flag logging;

void discardLog(enum ggml_log_level, const char*, void*) { }

std::string text(JNIEnv* env, jstring value) {
    const char* utf8 = env->GetStringUTFChars(value, nullptr);
    if (!utf8) return {};
    std::string copied(utf8);
    env->ReleaseStringUTFChars(value, utf8);
    return copied;
}
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_org_rightsdesk_mobile_OfflineSpeech_recognize(
        JNIEnv* env, jclass, jstring modelPath, jstring languageCode, jfloatArray pcm, jint threads) {
    if (!modelPath || !languageCode || !pcm) return nullptr;
    std::call_once(logging, [] { whisper_log_set(discardLog, nullptr); });
    const std::string path = text(env, modelPath);
    const std::string language = text(env, languageCode);
    if (env->ExceptionCheck() || path.empty() || whisper_lang_id(language.c_str()) < 0) return nullptr;

    const jsize count = env->GetArrayLength(pcm);
    if (count <= 0 || count > 5 * 60 * WHISPER_SAMPLE_RATE) return nullptr;
    std::vector<float> samples(count);
    env->GetFloatArrayRegion(pcm, 0, count, samples.data());
    if (env->ExceptionCheck()) return nullptr;

    whisper_context_params contextParams = whisper_context_default_params();
    contextParams.use_gpu = false;
    std::unique_ptr<whisper_context, decltype(&whisper_free)> context(
        whisper_init_from_file_with_params(path.c_str(), contextParams), whisper_free);
    if (!context) return nullptr;

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.language = language.c_str();
    params.n_threads = std::clamp<int>(threads, 1, 4);
    params.translate = false;
    params.no_context = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.print_special = false;
    if (whisper_full(context.get(), params, samples.data(), count) != 0) return nullptr;

    std::string transcript;
    for (int i = 0; i < whisper_full_n_segments(context.get()); ++i) {
        if (const char* segment = whisper_full_get_segment_text(context.get(), i)) transcript += segment;
    }
    jbyteArray result = env->NewByteArray(static_cast<jsize>(transcript.size()));
    if (result) env->SetByteArrayRegion(result, 0, static_cast<jsize>(transcript.size()),
                                      reinterpret_cast<const jbyte*>(transcript.data()));
    return result;
}
