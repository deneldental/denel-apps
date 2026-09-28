import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types'
import { staffAttendanceApp } from './staff-attendance'
import { staffCoreApp } from './staff-core'
import { staffMemosApp } from './staff-memos'
import { staffPayrollApp } from './staff-payroll'
import { staffPerformanceApp } from './staff-performance'
import { staffPersonalApp } from './staff-personal'
import { staffTrainingApp } from './staff-training'

const staffApp = new Hono<HonoEnv>()
// staffPersonal first: its /:staffId/contacts routes must match before
// staffCore's catch-all /:id patterns get a chance to swallow them.
staffApp.route('', staffPersonalApp)
staffApp.route('', staffCoreApp)
staffApp.route('', staffMemosApp)
staffApp.route('', staffPerformanceApp)
staffApp.route('', staffTrainingApp)
staffApp.route('', staffPayrollApp)
staffApp.route('', staffAttendanceApp)

export { staffApp }
