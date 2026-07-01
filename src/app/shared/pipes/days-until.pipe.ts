import { Pipe, PipeTransform } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { daysUntilCalendar } from '../../core/util/trip-date.util';

@Pipe({ name: 'daysUntil', standalone: true })
export class DaysUntilPipe implements PipeTransform {
  transform(date: Timestamp | undefined): string {
    if (!date) return '';
    // Calendar-day difference so a trip starting "tomorrow" never reads "Past"
    // in the evening of today (timezone-stable).
    const days = daysUntilCalendar(date.toDate());
    if (days < 0) return 'Past';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days away`;
  }
}
