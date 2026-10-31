import { Response } from 'express';

export const AUTH_SIGN_IN = 'Please sign in again.';
export const AUTH_NO_ACCESS = "You don't have access to this page.";
export const AUTH_NOT_FOUND = 'Not found';

export const successResponse = (
  res: Response,
  data: any,
  message: string = 'Success',
  statusCode: number = 200
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

export const errorResponse = (
  res: Response,
  message: string = 'An error occurred',
  statusCode: number = 500,
  errors: any = null,
  code?: string
) => {
  const body: Record<string, unknown> = {
    success: false,
    message,
    errors,
  };
  if (code) body.code = code;
  return res.status(statusCode).json(body);
};

export const unauthorizedResponse = (res: Response) =>
  errorResponse(res, AUTH_SIGN_IN, 401, null, 'unauthorized');

export const forbiddenResponse = (res: Response) =>
  errorResponse(res, AUTH_NO_ACCESS, 403, null, 'forbidden');

export const notFoundResponse = (res: Response, message = AUTH_NOT_FOUND) =>
  errorResponse(res, message, 404, null, 'not_found');

export const paginatedResponse = (
  res: Response,
  data: any[],
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  },
  message: string = 'Success',
  extra: Record<string, unknown> = {}
) => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination,
    ...extra,
  });
};
