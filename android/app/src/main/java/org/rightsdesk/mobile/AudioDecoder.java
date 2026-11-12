package org.rightsdesk.mobile;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.SystemClock;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

final class AudioDecoder {
    static final int MAX_MINUTES = 5;
    private static final int RATE = 16_000;
    private static final int MAX_SAMPLES = MAX_MINUTES * 60 * RATE;
    private static final long WAIT_US = 10_000L;
    private static final long STALL_MS = 15_000L;

    private AudioDecoder() {}

    static void validate(File file) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(file.getAbsolutePath());
            audioTrack(extractor);
        } finally {
            extractor.release();
        }
    }

    static float[] read(File file) throws IOException, InterruptedException {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(file.getAbsolutePath());
            int track = audioTrack(extractor);
            MediaFormat format = extractor.getTrackFormat(track);
            if (format.containsKey(MediaFormat.KEY_DURATION)
                    && format.getLong(MediaFormat.KEY_DURATION) > (long) MAX_MINUTES * 60_000_000L) {
                throw tooLong();
            }
            extractor.selectTrack(track);
            String mime = format.getString(MediaFormat.KEY_MIME);
            return "audio/raw".equals(mime) ? readPcm(extractor, format) : decode(extractor, format, mime);
        } finally {
            extractor.release();
        }
    }

    private static int audioTrack(MediaExtractor extractor) throws IOException {
        for (int i = 0; i < extractor.getTrackCount(); i++) {
            String mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
            if (mime != null && mime.startsWith("audio/")) return i;
        }
        throw new IOException("The file does not contain a readable audio track.");
    }

    private static float[] readPcm(MediaExtractor extractor, MediaFormat format)
            throws IOException, InterruptedException {
        Pcm output = new Pcm();
        ByteBuffer input = ByteBuffer.allocateDirect(1024 * 1024);
        while (true) {
            checkInterrupted();
            input.clear();
            int size = extractor.readSampleData(input, 0);
            if (size < 0) break;
            if (size > input.capacity()) throw new IOException("The recording contains an oversized audio frame.");
            input.position(0);
            input.limit(size);
            output.write(input, format);
            if (!extractor.advance()) break;
        }
        return output.finish();
    }

    private static float[] decode(MediaExtractor extractor, MediaFormat source, String mime)
            throws IOException, InterruptedException {
        MediaCodec codec = MediaCodec.createDecoderByType(mime);
        try {
            codec.configure(source, null, null, 0);
            codec.start();
            return decodeBuffers(extractor, codec, source);
        } finally {
            codec.release();
        }
    }

    private static float[] decodeBuffers(MediaExtractor extractor, MediaCodec codec, MediaFormat source)
            throws IOException, InterruptedException {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        MediaFormat format = source;
        Pcm output = new Pcm();
        boolean inputEnded = false;
        long activity = SystemClock.elapsedRealtime();
        while (true) {
            checkInterrupted();
            if (!inputEnded) {
                int index = codec.dequeueInputBuffer(WAIT_US);
                if (index >= 0) {
                    ByteBuffer buffer = codec.getInputBuffer(index);
                    if (buffer == null) throw new IOException("Could not read an audio buffer.");
                    buffer.clear();
                    int size = extractor.readSampleData(buffer, 0);
                    if (size < 0) {
                        codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                        inputEnded = true;
                    } else {
                        if (size > buffer.capacity()) throw new IOException("The recording contains an oversized audio frame.");
                        codec.queueInputBuffer(index, 0, size, Math.max(0, extractor.getSampleTime()), 0);
                        extractor.advance();
                    }
                    activity = SystemClock.elapsedRealtime();
                }
            }

            int index = codec.dequeueOutputBuffer(info, WAIT_US);
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                format = codec.getOutputFormat();
                activity = SystemClock.elapsedRealtime();
            } else if (index >= 0) {
                try {
                    if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        ByteBuffer buffer = codec.getOutputBuffer(index);
                        if (buffer == null) throw new IOException("Could not decode the audio.");
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        output.write(buffer, format);
                    }
                } finally {
                    codec.releaseOutputBuffer(index, false);
                }
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return output.finish();
                activity = SystemClock.elapsedRealtime();
            }
            if (SystemClock.elapsedRealtime() - activity > STALL_MS) throw new IOException("The audio decoder timed out.");
        }
    }

    private static void checkInterrupted() throws InterruptedException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
    }

    private static IOException tooLong() {
        return new IOException("Choose a recording up to " + MAX_MINUTES + " minutes to transcribe on this phone.");
    }

    // Downmix each frame, then average overlapping source frames into a 16 kHz stream.
    // This keeps memory bounded even when the input is long, stereo, or high sample rate.
    private static final class Pcm {
        private float[] samples = new float[RATE];
        private int size;
        private int sourceRate;
        private int filled;
        private float sum;
        private float peak;

        void write(ByteBuffer buffer, MediaFormat format) throws IOException {
            int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int encoding = format.containsKey(MediaFormat.KEY_PCM_ENCODING)
                    ? format.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
            int bytes = switch (encoding) {
                case AudioFormat.ENCODING_PCM_8BIT -> 1;
                case AudioFormat.ENCODING_PCM_16BIT -> 2;
                case AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3;
                case AudioFormat.ENCODING_PCM_32BIT, AudioFormat.ENCODING_PCM_FLOAT -> 4;
                default -> throw new IOException("This PCM audio format is not supported.");
            };
            if (rate < 4_000 || rate > 384_000 || channels < 1 || channels > 32) {
                throw new IOException("This recording has unsupported audio settings.");
            }
            if (sourceRate != 0 && sourceRate != rate) throw new IOException("The sample rate changes during the recording.");
            sourceRate = rate;
            buffer.order(ByteOrder.LITTLE_ENDIAN);
            int frameBytes = channels * bytes;
            while (buffer.remaining() >= frameBytes) {
                float frame = 0;
                for (int i = 0; i < channels; i++) frame += sample(buffer, encoding);
                addFrame(frame / channels);
            }
        }

        private void addFrame(float value) throws IOException {
            int remaining = RATE;
            while (remaining > 0) {
                int overlap = Math.min(remaining, sourceRate - filled);
                sum += value * overlap;
                filled += overlap;
                remaining -= overlap;
                if (filled == sourceRate) {
                    append(sum / sourceRate);
                    filled = 0;
                    sum = 0;
                }
            }
        }

        private void append(float value) throws IOException {
            if (size == MAX_SAMPLES) throw tooLong();
            if (size == samples.length) samples = Arrays.copyOf(samples, Math.min(samples.length * 2, MAX_SAMPLES));
            samples[size++] = value;
            peak = Math.max(peak, Math.abs(value));
        }

        float[] finish() throws IOException {
            if (filled > 0) append(sum / filled);
            if (size < RATE / 10 || peak < 0.0001f) throw new IOException("There is no audible speech in this recording.");
            return Arrays.copyOf(samples, size);
        }

        private static float sample(ByteBuffer buffer, int encoding) {
            return switch (encoding) {
                case AudioFormat.ENCODING_PCM_8BIT -> ((buffer.get() & 0xFF) - 128) / 128f;
                case AudioFormat.ENCODING_PCM_16BIT -> buffer.getShort() / 32_768f;
                case AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
                    int value = (buffer.get() & 0xFF) | ((buffer.get() & 0xFF) << 8) | (buffer.get() << 16);
                    yield value / 8_388_608f;
                }
                case AudioFormat.ENCODING_PCM_32BIT -> buffer.getInt() / 2_147_483_648f;
                case AudioFormat.ENCODING_PCM_FLOAT -> {
                    float value = buffer.getFloat();
                    yield Float.isFinite(value) ? Math.max(-1f, Math.min(1f, value)) : 0;
                }
                default -> 0;
            };
        }
    }
}
