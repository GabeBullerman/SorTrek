import { Component, Input, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { marked } from 'marked';
import { Trip } from '../../../core/models/trip.model';
import { AiAdvisorService, AiMessage } from '../../../core/services/ai-advisor.service';

const QUICK_PROMPTS = [
  'What should I know before visiting?',
  'What are the must-see places?',
  'What currency and tipping customs apply?',
  'What safety tips should I know?',
  'What local food should I try?',
  'What\'s the best way to get around?',
];

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule, MatIconModule, MatInputModule,
    MatFormFieldModule, MatProgressSpinnerModule, MatChipsModule,
  ],
  templateUrl: './ai-assistant.component.html',
  styleUrl: './ai-assistant.component.scss',
})
export class AiAssistantComponent {
  @Input() trip!: Trip;

  private aiService = inject(AiAdvisorService);

  readonly quickPrompts = QUICK_PROMPTS;
  messages = signal<AiMessage[]>([]);
  inputText = signal('');
  loading = signal(false);

  send(text?: string) {
    const content = (text ?? this.inputText()).trim();
    if (!content || this.loading()) return;

    this.inputText.set('');
    const updated = [...this.messages(), { role: 'user' as const, content }];
    this.messages.set(updated);
    this.loading.set(true);

    this.aiService.chat(this.trip, updated).subscribe(reply => {
      this.messages.update(m => [...m, { role: 'assistant' as const, content: reply }]);
      this.loading.set(false);
    });
  }

  private mdCache = new Map<string, string>();

  /** Render assistant markdown → HTML. Angular's built-in sanitizer runs on the
   *  [innerHTML] binding, so any script/handler an LLM (or a prompt injection)
   *  might emit is stripped — this stays XSS-safe. Cached so it isn't reparsed
   *  on every change-detection pass. */
  renderMarkdown(text: string): string {
    let html = this.mdCache.get(text);
    if (html === undefined) {
      html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
      this.mdCache.set(text, html);
    }
    return html;
  }

  onEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  clearChat() {
    this.messages.set([]);
  }
}
