import { Response } from 'express';

export const successResponse = (
  res: Response,
  data: any,
  message: string = 'Success',
  statusCode: number = 200
) => {
  const responseObj = {
    success: true,
    message,
    data,
  };
  return res.status(statusCode).json(responseObj);
};

export const errorResponse = (
  res: Response,
  message: string = 'An error occurred',
  statusCode: number = 500,
  errors: any = null
) => {
  const responseObj = {
    success: false,
    message,
    errors,
  };
  console.log('📤 SENDING ERROR RESPONSE:', JSON.stringify(responseObj, null, 2));
  return res.status(statusCode).json(responseObj);
};

export const paginatedResponse = (
  res: Response,
  data: any[],
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  },
  message: string = 'Success'
) => {
  const responseObj = {
    success: true,
    message,
    data,
    pagination,
  };
  return res.status(200).json(responseObj);
};



