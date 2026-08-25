/**
 * API Proxy Route Handler
 * Proxies requests from the frontend to the FastAPI backend
 * This handles all /api/proxy/* requests
 */

import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxy(request, params.path, 'GET')
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxy(request, params.path, 'POST')
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxy(request, params.path, 'PUT')
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxy(request, params.path, 'DELETE')
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxy(request, params.path, 'PATCH')
}

async function handleProxy(
  request: NextRequest,
  pathSegments: string[],
  method: string
) {
  try {
    // Build the backend URL
    const path = pathSegments.join('/')
    const url = new URL(request.url)
    const queryString = url.search
    const backendUrl = `${BACKEND_URL}/api/v1/${path}${queryString}`

    console.log(`[Proxy] ${method} ${backendUrl}`)

    // Get headers from the original request
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      // Skip host header and other hop-by-hop headers
      if (!['host', 'connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase())) {
        headers[key] = value
      }
    })

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const contentType = request.headers.get('content-type') || ''
      
      if (contentType.includes('application/json')) {
        try {
          const body = await request.json()
          fetchOptions.body = JSON.stringify(body)
        } catch {
          // If JSON parsing fails, try getting raw text
          fetchOptions.body = await request.text()
        }
      } else if (contentType.includes('multipart/form-data')) {
        // For multipart, let the browser handle the body
        fetchOptions.body = await request.blob()
      } else {
        fetchOptions.body = await request.text()
      }
    }

    // Make the request to the backend
    const response = await fetch(backendUrl, fetchOptions)

    // Get the response content type
    const responseContentType = response.headers.get('content-type') || ''

    // Handle streaming responses
    if (responseContentType.includes('text/event-stream')) {
      // Return streaming response as-is
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Handle JSON responses
    if (responseContentType.includes('application/json')) {
      const data = await response.json()
      return NextResponse.json(data, { status: response.status })
    }

    // Handle other responses (text, etc.)
    const text = await response.text()
    return new Response(text, {
      status: response.status,
      headers: {
        'Content-Type': responseContentType || 'text/plain',
      },
    })
  } catch (error) {
    console.error('[Proxy] Error:', error)
    return NextResponse.json(
      { 
        error: 'Proxy error', 
        message: error instanceof Error ? error.message : 'Unknown error',
        details: 'Failed to connect to backend server. Make sure the backend is running.'
      },
      { status: 502 }
    )
  }
}

