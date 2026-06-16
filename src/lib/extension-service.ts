// Extension Service for communicating with content script
import { UdemyCourse, TranscriptResult } from './udemy-extractor';

declare const chrome: any;

export interface ExtensionServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ExtensionService {
  /**
   * Simple text sanitization to prevent XSS
   */
  private static sanitizeText(text: string): string {
    return text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
      .replace(/javascript:/gi, '') // Remove javascript: links
      .trim();
  }

  /**
   * Send message to content script and get response
   */
  private static async sendMessage<T>(message: any): Promise<ExtensionServiceResponse<T>> {
    try {
      // Check if we're in a browser extension context
      if (typeof chrome === 'undefined' || !chrome.tabs) {
        throw new Error('Extension APIs not available');
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab found');
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, message);
        return response;
      } catch (connectionError) {
        // If the content script isn't there yet, inject it once and retry.
        const msg = connectionError instanceof Error ? connectionError.message : String(connectionError);
        if (!msg.includes('Receiving end does not exist')) {
          throw connectionError;
        }
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js'],
          });
          await new Promise((resolve) => setTimeout(resolve, 500));
          return await chrome.tabs.sendMessage(tab.id, message);
        } catch {
          throw new Error('Failed to connect to page. Please refresh the page and try again.');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Extension communication failed';
      console.error('Error sending message to content script:', error);
      return { success: false, error: message };
    }
  }

  /**
   * Check if current page supports transcript extraction
   */
  static async checkAvailability(): Promise<ExtensionServiceResponse<{
    platform: string;
    hasTranscript: boolean;
    isCoursePage: boolean;
  }>> {
    return this.sendMessage({ type: 'CHECK_AVAILABILITY' });
  }

  /**
   * Extract course structure from current page
   */
  static async extractCourseStructure(): Promise<ExtensionServiceResponse<UdemyCourse>> {
    return this.sendMessage({ type: 'EXTRACT_COURSE_STRUCTURE' });
  }

  /**
   * Extract transcript from the currently open video.
   */
  static async extractTranscript(): Promise<ExtensionServiceResponse<TranscriptResult>> {
    return this.sendMessage({ type: 'EXTRACT_TRANSCRIPT' });
  }

  /**
   * Title, id and sidebar key of the lecture currently loaded.
   */
  static async getLectureMeta(): Promise<ExtensionServiceResponse<{ lectureId: string; title: string; currentKey: string }>> {
    return this.sendMessage({ type: 'GET_LECTURE_META' });
  }

  /**
   * Items in the currently-expanded sidebar sections (the "open sections" set).
   */
  static async getOpenItems(): Promise<ExtensionServiceResponse<Array<{ key: string; title: string; isVideo: boolean; isCurrent: boolean }>>> {
    return this.sendMessage({ type: 'GET_OPEN_ITEMS' });
  }

  /**
   * Advance to the next lecture using Udemy's own "Next" button.
   */
  static async goToNext(): Promise<ExtensionServiceResponse<{ lectureId: string; changed: boolean }>> {
    return this.sendMessage({ type: 'GO_TO_NEXT' });
  }

  /**
   * Go back to the previous lecture using Udemy's own "Previous" button.
   */
  static async goToPrev(): Promise<ExtensionServiceResponse<{ lectureId: string; changed: boolean }>> {
    return this.sendMessage({ type: 'GO_TO_PREV' });
  }

  /**
   * Navigate directly to a sidebar item by its key. Resolves to true on success.
   */
  static async goToItem(key: string): Promise<ExtensionServiceResponse<boolean>> {
    return this.sendMessage({ type: 'GO_TO_ITEM', data: { key } });
  }

  /**
   * Get current video information
   */
  static async getVideoInfo(): Promise<ExtensionServiceResponse<{
    title: string;
    duration: string;
  }>> {
    return this.sendMessage({ type: 'GET_VIDEO_INFO' });
  }

  /**
   * Copy text to clipboard
   */
  static async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      return false;
    }
  }

  /**
   * Download file with given content
   */
  static downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
  }

  /**
   * Format transcript for different export types
   */
  static formatTranscript(transcript: string, format: 'markdown' | 'txt' | 'json' | 'rag', includeTimestamps: boolean = true, videoTitle?: string): string {
    // Sanitize input first
    const cleanTranscript = this.sanitizeText(transcript);
    
    switch (format) {
      case 'markdown':
        return this.formatAsMarkdown(cleanTranscript, includeTimestamps);
      case 'json':
        return this.formatAsJSON(cleanTranscript, includeTimestamps);
      case 'rag':
        return this.formatAsRAG(cleanTranscript, includeTimestamps, videoTitle);
      case 'txt':
      default:
        return this.formatAsText(cleanTranscript, includeTimestamps);
    }
  }

  private static formatAsMarkdown(transcript: string, includeTimestamps: boolean): string {
    // Clean paragraphs, no bullet prefixes. Strip timestamps when not wanted.
    const body = includeTimestamps ? transcript : transcript.replace(/^\[[^\]]*\]\s*/gm, '');
    return `# Transcript\n\n${body.trim()}`;
  }

  private static formatAsJSON(transcript: string, includeTimestamps: boolean): string {
    const lines = transcript.split('\n\n');
    const entries = lines.map(line => {
      if (includeTimestamps) {
        const match = line.match(/^\[([^\]]+)\]\s*(.+)$/);
        if (match) {
          return {
            timestamp: match[1],
            text: match[2]
          };
        }
      }
      return {
        text: line.replace(/^\[[^\]]+\]\s*/, '')
      };
    });
    
    return JSON.stringify({ entries }, null, 2);
  }

  private static formatAsText(transcript: string, includeTimestamps: boolean): string {
    if (includeTimestamps) {
      return transcript;
    } else {
      // Remove timestamps
      return transcript.replace(/^\[[^\]]+\]\s*/gm, '');
    }
  }

  private static formatAsRAG(transcript: string, includeTimestamps: boolean, videoTitle?: string): string {
    const lines = transcript.split('\n\n');
    
    // Clean and prepare transcript lines
    const cleanLines: string[] = [];
    
    lines.forEach((line) => {
      let text = line;
      let timestamp = '';
      
      if (includeTimestamps) {
        // Handle timestamp formats
        const timestampMatch = line.match(/^\[([^\]]*)\]\s*(.+)$/);
        if (timestampMatch) {
          const bracketContent = timestampMatch[1];
          text = timestampMatch[2];
          
          // Check if bracket content looks like a timestamp
          if (bracketContent && /^\d{1,2}:\d{2}(:\d{2})?$/.test(bracketContent)) {
            timestamp = bracketContent;
          } else {
            // Other content in brackets - treat as part of text
            text = line;
            timestamp = '';
          }
        } else {
          text = line;
          timestamp = '';
        }
      } else {
        // Remove any timestamp-like content from line
        text = line.replace(/^\[[^\]]*\]\s*/, '');
      }
      
      // Clean text (remove artifacts, extra spaces)
      text = text.trim().replace(/\s+/g, ' ');
      
      // Skip empty or very short lines, but keep meaningful content
      if (text && text.length >= 3 && /[a-zA-Z]/.test(text)) {
        cleanLines.push(text);
      }
    });
    
    // Smart chunking: merge lines until we reach target word count (50-60 words)
    const chunks = this.createSmartChunks(cleanLines, 55); // Target 55 words per chunk
    
    // Create RAG format with optimized chunks
    const ragChunks = chunks.map((chunk, index) => ({
      id: `chunk_${index + 1}`,
      content: chunk,
      metadata: {
        chunk_index: index + 1,
        source: 'video_transcript',
        type: 'educational_content',
        video_title: videoTitle || 'Unknown Video',
        word_count: chunk.split(/\s+/).length
      }
    }));
    
    return JSON.stringify({
      document_type: 'video_transcript',
      total_chunks: ragChunks.length,
      chunks: ragChunks,
      metadata: {
        extraction_date: new Date().toISOString(),
        format_version: '2.2',
        rag_optimized: true,
        chunking_strategy: 'smart_word_based',
        target_words_per_chunk: 55,
        total_words: cleanLines.join(' ').split(/\s+/).length,
        video_title: videoTitle || 'Unknown Video',
        video_info: {
          title: videoTitle || 'Unknown Video',
          platform: 'udemy',
          content_type: 'educational_video'
        }
      }
    }, null, 2);
  }

  /**
   * Create smart chunks based on word count, not line count
   * Merges small transcript segments into coherent 50-60 word chunks
   */
  private static createSmartChunks(lines: string[], targetWords: number): string[] {
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentWordCount = 0;
    
    for (const line of lines) {
      const words = line.split(/\s+/);
      const lineWordCount = words.length;
      
      // If adding this line would exceed target, finalize current chunk
      if (currentWordCount + lineWordCount > targetWords && currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [line];
        currentWordCount = lineWordCount;
      } else {
        // Add line to current chunk
        currentChunk.push(line);
        currentWordCount += lineWordCount;
      }
    }
    
    // Add final chunk if it has content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }
    
    // Post-process: merge very small chunks with previous ones
    const finalChunks: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const wordCount = chunk.split(/\s+/).length;
      
      // If chunk is too small (less than 20 words) and not the last chunk
      if (wordCount < 20 && i < chunks.length - 1) {
        // Merge with next chunk
        if (i + 1 < chunks.length) {
          finalChunks.push(chunk + ' ' + chunks[i + 1]);
          i++; // Skip next chunk since we merged it
        } else {
          finalChunks.push(chunk);
        }
      } else {
        finalChunks.push(chunk);
      }
    }
    
    return finalChunks;
  }

  /**
   * Generate filename for download
   */
  static generateFilename(videoTitle: string, format: string): string {
    const sanitizedTitle = videoTitle
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `${sanitizedTitle}_${timestamp}.${format}`;
  }

  /**
   * Get MIME type for format
   */
  static getMimeType(format: string): string {
    switch (format) {
      case 'markdown':
      case 'txt':
        return 'text/plain';
      case 'json':
      case 'rag':
        return 'application/json';
      default:
        return 'text/plain';
    }
  }

}
