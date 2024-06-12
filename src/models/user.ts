interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  institutionName: string;
  isAdmin?: boolean;
  fcmToken?: string;
}
export { User };
