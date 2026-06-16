// Content script for the Udemy Transcript Extractor.
// Runs in the page context and exposes DOM operations to the popup via messages.

import { UdemyExtractor } from './udemy-extractor';

declare const chrome: any;

export type ContentMessageType =
  | 'CHECK_AVAILABILITY'
  | 'GET_VIDEO_INFO'
  | 'EXTRACT_COURSE_STRUCTURE'
  | 'EXTRACT_TRANSCRIPT'
  | 'GET_LECTURE_META'
  | 'GET_OPEN_ITEMS'
  | 'GO_TO_NEXT'
  | 'GO_TO_PREV'
  | 'GO_TO_ITEM';

export interface ContentScriptMessage {
  type: ContentMessageType;
  data?: any;
}

export interface ContentScriptResponse {
  success: boolean;
  data?: any;
  error?: string;
}

declare global {
  interface Window {
    udemyTranscriptContentScript?: ContentScript;
  }
}

class ContentScript {
  private initialized = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    if (this.initialized) return;

    chrome.runtime.onMessage.addListener(
      (message: ContentScriptMessage, _sender: any, sendResponse: (r: ContentScriptResponse) => void) => {
        this.handleMessage(message)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) =>
            sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) })
          );
        return true; // keep the channel open for the async response
      }
    );

    this.initialized = true;
    window.udemyTranscriptContentScript = this;
  }

  private async handleMessage(message: ContentScriptMessage): Promise<any> {
    switch (message.type) {
      case 'CHECK_AVAILABILITY':
        return {
          platform: 'udemy',
          isCoursePage: UdemyExtractor.isUdemyCoursePage(),
          hasTranscript: UdemyExtractor.isTranscriptAvailable(),
        };

      case 'GET_VIDEO_INFO':
        return UdemyExtractor.getCurrentVideoInfo();

      case 'EXTRACT_COURSE_STRUCTURE':
        return UdemyExtractor.extractCourseStructure();

      case 'EXTRACT_TRANSCRIPT':
        // Extract whatever lecture is currently open. Returns { lectureId, transcript }.
        return UdemyExtractor.extractTranscript();

      case 'GET_LECTURE_META':
        // Title, id and sidebar key of the lecture currently loaded.
        return UdemyExtractor.getCurrentLectureMeta();

      case 'GET_OPEN_ITEMS':
        // Items in the currently-expanded sidebar sections (the "open sections" set).
        return UdemyExtractor.getOpenItems();

      case 'GO_TO_NEXT':
        // Click Udemy's "Next" button and wait for the new lecture to load.
        return UdemyExtractor.goToNext();

      case 'GO_TO_PREV':
        // Click Udemy's "Previous" button and wait for the new lecture to load.
        return UdemyExtractor.goToPrev();

      case 'GO_TO_ITEM':
        // Navigate directly to a sidebar item by its key.
        return UdemyExtractor.navigateToItem(message.data?.key);

      default:
        throw new Error(`Unknown message type: ${(message as ContentScriptMessage).type}`);
    }
  }
}

if (!window.udemyTranscriptContentScript) {
  try {
    new ContentScript();
  } catch (error) {
    console.error('Failed to initialize Udemy Transcript content script:', error);
  }
}
