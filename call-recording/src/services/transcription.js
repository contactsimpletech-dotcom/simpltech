const { OpenAI, toFile } = require('openai');
const config = require('../config');

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 *
 * @param {Buffer} audioBuffer  - Raw audio data
 * @param {string} contentType  - MIME type, e.g. 'audio/mpeg' or 'audio/wav'
 * @returns {Promise<string>}   - Transcribed text
 */
async function transcribe(audioBuffer, contentType = 'audio/mpeg') {
  const ext = contentType.includes('wav') ? 'wav' : 'mp3';
  const filename = `recording.${ext}`;

  console.log(`[transcription] Sending ${Math.round(audioBuffer.length / 1024)} KB to Whisper...`);

  const file = await toFile(audioBuffer, filename, { type: contentType });

  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'text',
  });

  const text = typeof response === 'string' ? response : response.text;
  console.log(`[transcription] Transcribed ${text.length} characters`);
  return text;
}

module.exports = { transcribe };
