import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SignIn from './SignIn.jsx'

describe('SignIn', () => {
  it('links to the server route that starts GitHub sign-in', () => {
    render(<SignIn />)
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute('href', '/api/auth/github')
    expect(screen.getByText(/public profile only/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so when the last attempt did not finish', () => {
    render(<SignIn failed />)
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in did not finish')
  })
})
