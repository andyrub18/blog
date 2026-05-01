function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  get DATABASE_URL() {
    return required('DATABASE_URL')
  },
  get BETTER_AUTH_SECRET() {
    return required('BETTER_AUTH_SECRET')
  },
  get BETTER_AUTH_URL() {
    return process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  },
}
