import { Component, HostListener, inject, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface GuidePage {
  title: string;
  icon: string;
  status: 'implemented' | 'in-progress' | 'planned' | 'paused';
  statusLabel: string;
  description: string;
  bullets: string[];
  gifPath: string;
}

const PAGES: GuidePage[] = [
  {
    title: 'My Trips',
    icon: 'flight_takeoff',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Create and manage all your trips from one dashboard. Each trip has its own destination, date range, cover photo, and currency.',
    bullets: [
      'Create trips with destination, dates, and currency',
      'Upload a cover photo to personalise each trip card',
      'View upcoming and past trips separately',
      'Edit or delete trips at any time',
    ],
    gifPath: 'guide/trips.svg',
  },
  {
    title: 'Overview & Map',
    icon: 'map',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'The Overview tab is the home of each trip — an interactive Google Map of your plans plus a weather forecast, cost summary, and an at-a-glance booking timeline.',
    bullets: [
      'Interactive map pins your activities and located bookings (hotels, rentals)',
      'Pick a day to draw a walking, driving, transit, or cycling route between stops',
      'Live weather forecast for your destination and a running total trip cost',
      'Card-flagging reminder banner appears within 14 days of departure',
    ],
    gifPath: 'guide/overview.svg',
  },
  {
    title: 'Schedule',
    icon: 'event_note',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Build a day-by-day itinerary for your trip. SorTrek warns you when a day has no transport planned, and AI can suggest things to do.',
    bullets: [
      'Add activities, transport, food, and accommodation per day',
      'Colour-coded timeline view per day',
      'AI "Find Plans" suggests real things to do at your destination',
      'Transport gap warnings on days with flights/hotels but no travel planned',
    ],
    gifPath: 'guide/schedule.svg',
  },
  {
    title: 'Bookings',
    icon: 'confirmation_number',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Track all your flights, hotels, car rentals, and other bookings in one place. Scan your emails to import confirmations automatically.',
    bullets: [
      'Add flights, hotels, Airbnbs, car rentals, and more',
      'Scan Gmail to auto-import booking confirmation emails',
      'Suggested bookings from transport search are clearly marked as unconfirmed',
      'Hints warn you about missing return flights or accommodation',
    ],
    gifPath: 'guide/bookings.svg',
  },
  {
    title: 'Transport',
    icon: 'directions_transit',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Search live European train schedules, real-time flight offers, hotel availability, and local options like bike share and car rentals near your destination.',
    bullets: [
      'Live train search via Deutsche Bahn API (European rail)',
      'Flight search via Amadeus (requires API key)',
      'Hotel search via Amadeus Hotel Offers API',
      'Local transport auto-loaded: buses, trams, bike share, car rentals, ferries',
      'AI transport advisor generates a personalised travel plan',
    ],
    gifPath: 'guide/transport.svg',
  },
  {
    title: 'Photos / Shared Album',
    icon: 'photo_library',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'A shared photo album for the whole trip. Anyone on the trip can upload pictures and everyone sees them in a single gallery, each tagged with who added it.',
    bullets: [
      'Drag-and-drop or pick multiple images, with a live upload progress bar',
      'Every photo shows uploader attribution and an optional caption',
      'Tap a photo to open a full-screen lightbox with uploader and date',
      'Delete your own photos; broken or missing images are cleaned up automatically',
    ],
    gifPath: 'guide/photos.svg',
  },
  {
    title: 'Packing List',
    icon: 'luggage',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'A collaborative packing checklist grouped by category, with shared progress tracking and AI-generated suggestions tailored to your destination and dates.',
    bullets: [
      'Items grouped by category: documents, clothing, electronics, toiletries, and more',
      'Check items off per person — shared items track who has packed them',
      'Mark items personal (private to you) or assign them to a travel companion',
      'AI "Suggest Items" proposes a packing list based on your trip; add with one tap',
    ],
    gifPath: 'guide/packing.svg',
  },
  {
    title: 'Document Vault',
    icon: 'folder_open',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Securely upload and organise travel documents per trip — passports, visas, insurance cards, vaccination records, and more.',
    bullets: [
      'Upload any file type (PDF, image, doc) up to 25 MB',
      'Categorise by type: passport, visa, insurance, vaccination, and more',
      'Expiry date warnings when a document expires within 90 days',
      'Documents stored securely in Firebase, private to your account',
    ],
    gifPath: 'guide/documents.svg',
  },
  {
    title: 'Costs & Currency',
    icon: 'payments',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Track every expense, see a full breakdown by category, connect your bank to import transactions, and convert costs to your home currency instantly.',
    bullets: [
      'Log expenses manually or import from connected bank via Plaid',
      'Breakdown by flights, accommodation, food, transport, and activities',
      'Currency converter with common amounts, FX fee estimator, and live rates',
      'Per-person cost split across trip participants',
    ],
    gifPath: 'guide/costs.svg',
  },
  {
    title: 'Collaborative Trips',
    icon: 'group',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Invite other SorTrek users to collaborate on a trip by email. Collaborators can view and edit all tabs in real time.',
    bullets: [
      'Invite any registered SorTrek user by email from the People tab',
      'Shared trips appear in collaborators\' trip lists with a badge',
      'Trip owner can remove collaborators at any time',
      'Separate from Travel Companions — those don\'t need SorTrek accounts',
    ],
    gifPath: 'guide/collab.svg',
  },
  {
    title: 'Card Flagging Reminders',
    icon: 'credit_card',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'A reminder banner appears on the Overview tab when your departure is within 14 days, prompting you to notify your bank before travelling abroad.',
    bullets: [
      'Appears automatically within 14 days of departure',
      'Checklist: set travel notice, check FX fees, save international contact number',
      'Enable browser notifications for a 48-hour-before-departure alert',
      'Dismiss per trip — won\'t reappear after acknowledged',
    ],
    gifPath: 'guide/card-reminder.svg',
  },
  {
    title: 'AI Assistant',
    icon: 'auto_awesome',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Chat with an AI that knows your trip details — ask for packing advice, destination tips, local customs, budget estimates, and more.',
    bullets: [
      'Context-aware: knows your destination, dates, and trip name',
      'Packing suggestions, weather tips, local customs, safety info',
      'Powered by Groq / LLaMA 3.3 70B for fast responses',
      'Conversation history kept per trip session',
    ],
    gifPath: 'guide/ai.svg',
  },
  {
    title: 'Profile & Settings',
    icon: 'person',
    status: 'implemented',
    statusLabel: 'Fully Implemented',
    description: 'Manage your account details and app preferences. Your home city and home currency feed features across SorTrek, like currency conversion and cost displays.',
    bullets: [
      'Set your display name, which appears on shared photos and collaborative trips',
      'Choose a home city (with Google Places autocomplete) and home currency',
      'Enable browser push notifications and send a test notification to verify them',
      'Home currency drives cost conversion throughout the app',
    ],
    gifPath: 'guide/profile.svg',
  },
  {
    title: 'Offline & PWA',
    icon: 'offline_bolt',
    status: 'implemented',
    statusLabel: 'Fully Implemented (production only)',
    description: 'Install SorTrek to your home screen and access your trips without an internet connection — perfect for airports and international roaming.',
    bullets: [
      'Install prompt appears automatically in supported browsers',
      'Trip data, itinerary, and bookings available offline via IndexedDB',
      'Recent transport and weather results cached by service worker',
      'Edits made offline sync automatically when connectivity returns',
    ],
    gifPath: 'guide/pwa.svg',
  },
];

@Component({
  selector: 'app-guide-modal',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatDialogModule, MatTooltipModule],
  templateUrl: './guide-modal.component.html',
  styleUrl: './guide-modal.component.scss',
})
export class GuideModalComponent {
  private dialogRef = inject(MatDialogRef<GuideModalComponent>);

  readonly pages = PAGES;
  readonly total  = PAGES.length;
  currentIndex    = signal(0);

  readonly currentPage = computed(() => this.pages[this.currentIndex()]);
  readonly isFirst     = computed(() => this.currentIndex() === 0);
  readonly isLast      = computed(() => this.currentIndex() === this.total - 1);

  prev() { if (!this.isFirst()) this.currentIndex.update(i => i - 1); }
  next() { if (!this.isLast())  this.currentIndex.update(i => i + 1); }
  goTo(i: number) { this.currentIndex.set(i); }
  close() { this.dialogRef.close(); }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') this.next();
    if (e.key === 'ArrowLeft')  this.prev();
  }

  statusColor(status: GuidePage['status']): string {
    const map: Record<GuidePage['status'], string> = {
      implemented:  '#2e7d32',
      'in-progress': '#1565c0',
      planned:      '#616161',
      paused:       '#e65100',
    };
    return map[status];
  }

  statusBg(status: GuidePage['status']): string {
    const map: Record<GuidePage['status'], string> = {
      implemented:  '#e8f5e9',
      'in-progress': '#e3f2fd',
      planned:      '#f5f5f5',
      paused:       '#fff3e0',
    };
    return map[status];
  }
}
