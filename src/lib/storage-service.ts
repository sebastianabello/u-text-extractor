// Persists popup UI state across popup open/close using chrome.storage.local.

declare const chrome: any;

export interface ExtensionState {
  courseStructure: any;
  currentVideo: { title: string; duration: string } | null;
  availability: { platform: string; hasTranscript: boolean; isCoursePage: boolean } | null;
  extractedTranscript: string;
  extractionStatus: 'idle' | 'extracting' | 'success' | 'error';
  exportFormat: 'markdown' | 'txt' | 'json' | 'rag';
  exportTarget: 'clipboard' | 'download';
  includeTimestamps: boolean;
}

export class StorageService {
  private static readonly STORAGE_KEY = 'udemyTranscriptExtractorState';

  static getDefaultState(): ExtensionState {
    return {
      courseStructure: null,
      currentVideo: null,
      availability: null,
      extractedTranscript: '',
      extractionStatus: 'idle',
      exportFormat: 'markdown',
      exportTarget: 'clipboard',
      includeTimestamps: true,
    };
  }

  static async saveState(state: Partial<ExtensionState>): Promise<void> {
    try {
      const updated = { ...(await this.loadState()), ...state };

      // Avoid blowing past chrome.storage limits with a huge transcript.
      if (JSON.stringify(updated).length > 4_000_000) {
        updated.extractedTranscript = '';
        updated.extractionStatus = 'idle';
      }

      await chrome.storage.local.set({ [this.STORAGE_KEY]: updated });
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  static async loadState(): Promise<ExtensionState> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      return result[this.STORAGE_KEY]
        ? { ...this.getDefaultState(), ...result[this.STORAGE_KEY] }
        : this.getDefaultState();
    } catch (error) {
      console.error('Failed to load state:', error);
      return this.getDefaultState();
    }
  }

  static async saveCourseStructure(courseStructure: any): Promise<void> {
    await this.saveState({ courseStructure });
  }

  static async clearState(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear state:', error);
    }
  }
}
