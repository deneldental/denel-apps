export interface FinanceYear {
  year: string
  total: number
}

export interface FinanceMonth {
  id: string
  name: string
  total: number
}

export interface FinanceWeek {
  id: string
  name: string
  range: string
  total: number
}

export interface PayrollEntry {
  id: string
  employeeId: string
  employeeName: string
  role: string
  baseSalary: number
  deductions: number
  netPay: number
  month: string
  year: string
  status: 'paid' | 'pending' | 'processing'
}

export const getYears = async (): Promise<FinanceYear[]> => {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500))
  return [
    { year: '2025', total: 230000 },
    { year: '2024', total: 180000 },
    { year: '2023', total: 150000 },
  ]
}

export const getMonths = async (_year: string): Promise<FinanceMonth[]> => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  return months.map((m) => ({
    id: m.toLowerCase(),
    name: m,
    total: Math.floor(Math.random() * 20000) + 5000,
  }))
}

export const getWeeks = async (_year: string, _month: string): Promise<FinanceWeek[]> => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  // Simple logic: 4 weeks for simplicity
  return [
    { id: '1', name: 'Week 1', range: '1st - 7th', total: Math.floor(Math.random() * 5000) + 1000 },
    {
      id: '2',
      name: 'Week 2',
      range: '8th - 14th',
      total: Math.floor(Math.random() * 5000) + 1000,
    },
    {
      id: '3',
      name: 'Week 3',
      range: '15th - 21st',
      total: Math.floor(Math.random() * 5000) + 1000,
    },
    {
      id: '4',
      name: 'Week 4',
      range: '22nd - End',
      total: Math.floor(Math.random() * 5000) + 1000,
    },
  ]
}

export const getPayrollData = async (year: string, month: string): Promise<PayrollEntry[]> => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  return [
    {
      id: 'p1',
      employeeId: 'EMP001',
      employeeName: 'John Doe',
      role: 'Software Engineer',
      baseSalary: 5000,
      deductions: 500,
      netPay: 4500,
      month: month,
      year: year,
      status: 'paid',
    },
    {
      id: 'p2',
      employeeId: 'EMP002',
      employeeName: 'Jane Smith',
      role: 'Product Manager',
      baseSalary: 6000,
      deductions: 800,
      netPay: 5200,
      month: month,
      year: year,
      status: 'pending',
    },
    {
      id: 'p3',
      employeeId: 'EMP003',
      employeeName: 'Bob Johnson',
      role: 'Designer',
      baseSalary: 4500,
      deductions: 400,
      netPay: 4100,
      month: month,
      year: year,
      status: 'processing',
    },
  ]
}
