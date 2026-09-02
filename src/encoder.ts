import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from 'mediabunny';
import type { Config } from './config';

const CODEC_PREFERENCE: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1'];

export class Mp4Encoder {
  private output: Output;
  private source: CanvasSource;
  readonly codec: VideoCodec;
  private frameDuration: number;

  private constructor(output: Output, source: CanvasSource, codec: VideoCodec, fps: number) {
    this.output = output;
    this.source = source;
    this.codec = codec;
    this.frameDuration = 1 / fps;
  }

  static async create(canvas: HTMLCanvasElement, config: Config): Promise<Mp4Encoder> {
    const format = new Mp4OutputFormat();
    const codec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((c) => CODEC_PREFERENCE.includes(c)),
      { width: config.video.width, height: config.video.height },
    );
    if (!codec) {
      throw new Error(
        `This browser cannot encode ${config.video.width}x${config.video.height} video ` +
          `in any MP4-compatible codec (tried: ${CODEC_PREFERENCE.join(', ')}).`,
      );
    }

    const output = new Output({
      format,
      target: new BufferTarget(),
    });
    const source = new CanvasSource(canvas, {
      codec,
      bitrate: config.video.bitrate,
    });
    output.addVideoTrack(source, { frameRate: config.video.fps });
    await output.start();

    return new Mp4Encoder(output, source, codec, config.video.fps);
  }

  /** Captures the canvas' current content as frame `index`. Applies encoder backpressure. */
  async addFrame(index: number): Promise<void> {
    await this.source.add(index * this.frameDuration, this.frameDuration);
  }

  /** Finishes the encode and returns the complete MP4 file. */
  async finalize(): Promise<Blob> {
    this.source.close();
    await this.output.finalize();
    const buffer = (this.output.target as BufferTarget).buffer;
    if (!buffer) {
      throw new Error('Encoding produced no output.');
    }
    return new Blob([buffer], { type: this.output.format.mimeType });
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}
