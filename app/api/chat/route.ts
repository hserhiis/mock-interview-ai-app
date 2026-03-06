import { NextResponse } from 'next/server';
import { Groq } from "groq-sdk";
import { EdgeTTS } from 'node-edge-tts';
import fs from 'fs/promises';
import path from 'path';
import os from 'os'; // Нужно для временной папки

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
    let filePath = ''; // Чтобы достать его в блоке finally

    try {
        const { messages, vacancy } = await req.json();

        // ТВОЙ ОРИГИНАЛЬНЫЙ КОНФИГ
        const config = {
            voice: 'en-US-AndrewMultilingualNeural',
            pitch: '+0Hz',
            rate: '+5%',
        };

        const isFirstMessage = messages.length === 0;

        const systemPrompt = `
ROLE: Andrew, Senior Dev at "Vortex Stream".
CONTEXT: conducting a Zoom interview for: ${vacancy}.

STRICT RULE: ONLY speak English. 
STRICT RULE: If messages.length > 0, DO NOT introduce yourself or the company again. Skip straight to the conversation or technical questions.

CURRENT PHASE:
${isFirstMessage
            ? "PHASE 1: Intro yourself and Vortex Stream (real-time data platform), then ask how they started coding."
            : "PHASE 2: Deep dive. React, Next.js, Prisma, SQL, System Design. React to their previous answer, then ask ONE sharp technical question."}

PERSONALITY:
- Tech-bro, energetic, uses: "under the hood", "shaky ground", "technical debt".
- If they mention "Prisma" or "Schema", show that you understand—those are key for Vortex Stream.

RULES:
- Ask ONLY ONE question.
- No repeating introductions.
`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                ...messages.slice(-10)
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
        });

        const aiText = chatCompletion.choices[0]?.message?.content || "Connection issues... Could you repeat that, please?";

        // ТВОЙ ОРИГИНАЛЬНЫЙ TTS
        const tts = new EdgeTTS({
            voice: config.voice,
            lang: 'en-US',
            pitch: config.pitch,
            rate: config.rate,
            volume: 'default',
            timeout: 30000
        });

        // ПРАВКА ДЛЯ VERCEL: пишем в /tmp
        const fileName = `speech-${Date.now()}.mp3`;
        filePath = path.join(os.tmpdir(), fileName);

        try {
            await tts.ttsPromise(aiText, filePath);
            const audioBuffer = await fs.readFile(filePath);
            const audioBase64 = audioBuffer.toString('base64');

            // Возвращаем результат
            return NextResponse.json({
                text: aiText,
                audio: `data:audio/mp3;base64,${audioBase64}`
            });
        } catch (ttsErr) {
            console.error("TTS Error:", ttsErr);
            return NextResponse.json({ text: aiText, audio: null });
        } finally {
            // ЧИСТИМ ЗА СОБОЙ (чтобы файлы не копились в /tmp)
            if (filePath) {
                try {
                    await fs.unlink(filePath);
                } catch (e) {}
            }
        }

    } catch (error: any) {
        console.error("GROQ ERROR:", error);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}