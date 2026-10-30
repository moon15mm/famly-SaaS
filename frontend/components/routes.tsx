"use client";
import { Catalog, ProductDetail, Households } from "./catalog";
import { Cart, Checkout } from "./checkout";
import { Auth } from "./auth";
import { Account, Favorites, Orders, Gate } from "./account";
import dynamic from "next/dynamic";
const Seller = dynamic(() => import("./seller").then((m) => m.Seller));
const Driver = dynamic(() => import("./driver").then((m) => m.Driver));
const Admin = dynamic(() => import("./admin").then((m) => m.Admin));
import {
  AccountSecurity,
  AddressBook,
  Recovery,
  Mailbox,
} from "./account-tools";
import { DocumentsPanel, ReceiptPage } from "./business-tools";
import { Policy } from "./policies";
export function RouteView({ path }: { path: string[] }) {
  switch (path[0]) {
    case "addresses":
      return (
        <Gate>
          <AddressBook />
        </Gate>
      );
    case "verification":
      return (
        <Gate>
          <div className="container page">
            <DocumentsPanel />
          </div>
        </Gate>
      );
    case "forgot-password":
      return <Recovery mode="forgot" />;
    case "reset-password":
      return <Recovery mode="reset" />;
    case "verify-email":
      return <Recovery mode="verify" />;
    case "mailbox":
      return <Mailbox />;
    case "receipt":
      return (
        <Gate>
          <ReceiptPage id={path[1]} />
        </Gate>
      );
    case "invoices":
      return (
        <Gate>
          <ReceiptPage id={path[1]} subscription />
        </Gate>
      );
    case "search":
    case "categories":
      return <Catalog />;
    case "product":
      return <ProductDetail id={path[1]} />;
    case "household":
      return <Catalog householdId={path[1]} />;
    case "households":
      return <Households />;
    case "cart":
      return <Cart />;
    case "checkout":
      return <Checkout />;
    case "login":
      return <Auth />;
    case "register":
      return <Auth register />;
    case "join":
      return <Auth register seller />;
    case "orders":
    case "track":
      return <Orders id={path[1]} />;
    case "account":
      return <Account />;
    case "favorites":
      return <Favorites />;
    case "seller":
      return <Seller />;
    case "driver":
      return <Driver />;
    case "admin":
      return <Admin />;
    case "policies":
      return <Policy slug={path[1]} />;
    default:
      return null;
  }
}
