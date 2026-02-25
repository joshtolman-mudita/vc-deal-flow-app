import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { loadDiligenceCriteria } from '@/lib/google-sheets';
import { buildChatContext } from '@/lib/diligence-scorer';
import { ChatMessage } from '@/types/diligence';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * POST /api/diligence/chat - Chat with AI about diligence
 * Returns a streaming response for real-time chat
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { diligenceId, message } = body;

    if (!diligenceId || !message) {
      return new Response(
        JSON.stringify({ error: 'Diligence ID and message are required' }),
        { status: 400 }
      );
    }

    // Load the diligence record
    const record = await loadDiligenceRecord(diligenceId);
    if (!record) {
      return new Response(
        JSON.stringify({ error: 'Diligence record not found' }),
        { status: 404 }
      );
    }

    // Load criteria
    const criteria = await loadDiligenceCriteria();

    // Prepare document texts
    const documentTexts = record.documents
      .filter(doc => doc.extractedText)
      .map(doc => ({
        fileName: doc.name,
        text: doc.extractedText || '',
        type: doc.type,
      }));

    // Build context for the chat
    const context = buildChatContext(
      record.companyName,
      documentTexts,
      record.score,
      criteria,
      record.notes,
      record.categorizedNotes || []
    );

    // Prepare messages for OpenAI
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: context,
      },
      // Include chat history
      ...record.chatHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      // Add new user message
      {
        role: 'user',
        content: message,
      },
    ];

    // Create streaming response
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      stream: true,
      temperature: 0.7, // Slightly higher for more natural conversation
    });

    // Convert OpenAI stream to Response stream
    const encoder = new TextEncoder();
    let fullResponse = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || '';
            fullResponse += text;
            controller.enqueue(encoder.encode(text));
          }

          // After streaming is complete, save the chat history
          const userMessage: ChatMessage = {
            id: `msg_${Date.now()}_user`,
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
          };

          const assistantMessage: ChatMessage = {
            id: `msg_${Date.now()}_assistant`,
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString(),
          };

          await updateDiligenceRecord(diligenceId, {
            chatHistory: [...record.chatHistory, userMessage, assistantMessage],
          });

          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in chat endpoint:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Failed to process chat message' 
      }),
      { status: 500 }
    );
  }
}
