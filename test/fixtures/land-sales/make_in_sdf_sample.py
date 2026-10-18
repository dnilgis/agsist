"""Writes in-sdf-sample.zip: a synthetic Indiana sales disclosure file in the real SDF_<year>.zip shape
(the column titles of the Oct 2026 STATS Indiana file, tab-delimited, every field quoted, SALEDISC and
SALECONTAC in UTF-16). Names and numbers are made up; the shapes (implied decimals, county numbers,
typed county names) are the real ones. scripts/fetch_land_sales.py --selftest reads it.
    python3 test/fixtures/land-sales/make_in_sdf_sample.py [fee_scale] [acre_scale] [out]"""
import io
import os
import sys
import zipfile

HEAD = {}
for line in """SALEDISC.txt SDF_ID|County_ID|County_Name|B1_Valuable_Consider|B2_Buyer_Adjacent|B3_Vacant_Land|B4_Trade|B4_Trade_Parcel|B5_Land_Contract|B5_Land_Contract_Term|B5_Land_Contract_Date|B6_Partial_Interest|B6_Partial_Description|B7_Easement|B8_Court_Order|B9_Partition|B10_Charity|C1_Sheriff_Sale|C2_Short_Sale|C3_Quitclaim|C4_Auction|C5_Other|C6_Multiple_Forms|C6_Form_Total|C7_Conveyance_Date|C8_Market_Days|C9_Num_Parcels|C10_Residential_Property|C10_Agricultural_Property|C10_Commercial_Property|C10_Industrial_Property|D_Confidential_Use|D1_Physical_Change|D1_Physical_Change_Desc|D2_Res_Rental|D3_Planned_Use|E1_Sales_Price|E2_PersProp|E3_Seller_Points|E4_Relationship_Discount|E5_Ownership_Interest|E6_Seller_Financed|E7_Buyer_Loan|E8_Mortgage_Loan|E9_Appraisal_Value|F_Confidential_Use|F1_Physical_Change|F1_Physical_Change_Desc|F2_Res_Rental|F3_Planned_Use|G_Confidential_Finance|G1_Sales_Price|G2_Existing_Business|G3_Liquor_License|G4_Portfolio_Sale|G5_Leased|G6_Abatement|G7_Appraisal|G7_Appraisal_Value|G8_TIF_District|G9_Financing_Cash|G9_Financing_Seller_Finan|G9_Financing_Construction|G9_Financing_Mortgage|G9_Financing_Leaseback|G9_Financing_Small_Busi|G10_Marketed_Word|G10_Marketed_Broker|G10_Marketed_Sign|G10_Marketed_Buyer|G11_Special_Relationship|G11_Special_Foreclosure|G11_Special_Auction|G11_Special_Trade|G11_Special_Partial|G12_PersProp|G13_IntangiblePersProp|J1_Primary_Residence|J2_Vacated_Homestead|J2_CountyNumber|J2_Street1|J2_City|J2_State|J2_PostalCode|J2_County|J3_Homestead|J4_Solar|J5_Wind|J6_Hydroelectric|J7_Geothermal|P2_10_Physical_Changes|P2_11_Form_Complete|P2_12_Fee_Required|P2_13_Date_Sale|P2_14_Date_Received|P2_15_Special_Circum|P2_16_Valid_Trending|P2_17_Validation_Complete|P2_18_Validated_By|P2_Assessor_Stamp|P3_1_Disclosure_Fee|P3_2_Local_Fee|P3_3_Total_Fee|P3_4_Receipt_Num|P3_5_Transfer_Date|P3_6_Form_Complete|P3_7_Fee_Collected|P3_8_Attach_Complete|P3_Auditor_Stamp|Unique_Sales_ID|Religious_Use_Property_Tax_Exemption
SALEPARCEL.txt SDF_ID|Parcel_Instance_No|A1_Parcel_Number|A1_Subdiv_Name|A1_Subdiv_Lot_Num|A2_Split|A3_Land|A4_Improvement|A5_Street1|A5_City|A5_State|A5_ZipCode|A6_Street1|A6_City|A6_State|A6_ZIPCode|A7_Legal_Description|P2_1_Parcel_Num_Verified|P2_2_AV_Land|P2_3_AV_Improvement|P2_4_AV_PersProp|P2_5_Total_AV|P2_6_Prop_Class_Code|P2_7_Neighborhood_Code|P2_8_Tax_District|P2_9_Acreage|J3_Homestead_Verified|J4_Solar_Verified|J5_Wind_Verified|J6_Hydroelectric_Verified|J7_Geothermal_Verified
SALECONTAC.txt SDF_ID|Contact_Instance_No|Contact_Type|Name|Suffix|Title|Company|Street1|Street2|City|State|zipCode|Country|Phone|Extension|EmailAddress|Sign_Verified""".strip().splitlines():
    name, cols = line.split(" ", 1)
    HEAD[name] = cols.split("|")


def tsv(rows, cols):
    return "\r\n".join("\t".join('"%s"' % str(r.get(c, "")) for c in cols) for r in [dict(zip(cols, cols))] + rows) + "\r\n"


def make(fee=100, acre=10000):
    D, P, C = [], [], []

    def form(n, cid, cname, price, parcels, buyer="SYNTHETIC BUYER", seller="SYNTHETIC SELLER", **kw):
        sid = "C%s-2026-%07d" % (cid, n)
        d = {"SDF_ID": sid, "County_ID": cid, "County_Name": cname, "B1_Valuable_Consider": "Y", "C7_Conveyance_Date": "2026-03-%02d" % n,
             "P2_13_Date_Sale": "2026-03-%02d" % n, "P2_14_Date_Received": "2026-04-%02d" % n, "E1_Sales_Price": str(int(price * 100)),
             "E2_PersProp": "0", "E4_Relationship_Discount": "0", "G1_Sales_Price": "0", "C9_Num_Parcels": str(len(parcels)),
             "P2_12_Fee_Required": "Y", "P3_7_Fee_Collected": "Y", "P3_1_Disclosure_Fee": str(20 * fee), "Unique_Sales_ID": sid}
        for k in [c for c in HEAD["SALEDISC.txt"] if c[:2] in ("B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B1", "C1", "C2", "C3", "C4", "C6")]:
            d.setdefault(k, "N")
        d["B1_Valuable_Consider"] = "Y"
        # the real file's blanks: no contract date reads 1900-01-01, the text boxes are empty
        d.update({"B4_Trade_Parcel": "", "B5_Land_Contract_Term": "", "B5_Land_Contract_Date": "1900-01-01", "B6_Partial_Description": "",
                  "C6_Form_Total": "", "P2_16_Valid_Trending": "Y", "P2_17_Validation_Complete": "Y"})
        split = kw.pop("split", False)
        d.update(kw)
        D.append(d)
        for i, (pin, cls, ac, imp) in enumerate(parcels):
            P.append({"SDF_ID": sid, "Parcel_Instance_No": "%03d" % (i + 1), "A1_Parcel_Number": pin, "A2_Split": "Y" if split and i == 0 else "N", "A3_Land": "N" if imp else "Y",
                      "A4_Improvement": "Y" if imp else "N", "A5_City": "SAMPLETOWN", "A5_State": "IN", "A5_ZipCode": "46711",
                      "A7_Legal_Description": "SYNTHETIC PT NW 1/4 SEC %d" % n, "P2_6_Prop_Class_Code": cls, "P2_9_Acreage": str(int(round(ac * acre)))})
        C.append({"SDF_ID": sid, "Contact_Instance_No": "001", "Contact_Type": "S", "Name": seller, "Phone": "5550000000"})
        C.append({"SDF_ID": sid, "Contact_Instance_No": "002", "Contact_Type": "B", "Name": buyer})
        C.append({"SDF_ID": sid, "Contact_Instance_No": "003", "Contact_Type": "P", "Name": "SYNTHETIC PREPARER"})
    form(1, "01", "Adams", 400000, [("010000000000000001", "100", 40.0, False)], B3_Vacant_Land="Y")
    form(2, "01", "ADAMS COUNTY", 500000, [("010000000000000002", "101", 30.5, True), ("010000000000000003", "100", 9.5, False)],
         E2_PersProp="1000000", B5_Land_Contract="Y")
    form(3, "01", "Adams", 250000, [("010000000000000004", "510", 0.5, True)])
    form(4, "08", "Carrol", 120000, [("080000000000000005", "100", 20.0, False)], B1_Valuable_Consider="N")
    form(5, "08", "Carrol", 90000, [("080000000000000006", "100", 10.0, False)], C3_Quitclaim="Y", E4_Relationship_Discount="2000000",
         P2_16_Valid_Trending="N")
    form(6, "08", "Carroll", 800000, [("080000000000000007", "100", 80.0, False)], C6_Multiple_Forms="Y")
    form(7, "92", "WHITLEY COUNTY", 1500000, [("920000000000000008", "100", 80.0, False), ("920000000000000009", "100", 80.0, False)])
    form(8, "92", "Whitley", 200000, [("920000000000000010", "120", 25.0, False)], C4_Auction="Y", B2_Buyer_Adjacent="Y")
    form(9, "92", "Whitley", 0, [("920000000000000011", "100", 5.0, False), ("920000000000000012", "400", 1.0, True)], G1_Sales_Price="30000000")
    form(10, "92", "Whitley", 50000, [("920000000000000013", "101", 4.0, True)], B6_Partial_Interest="Y")
    form(11, "92", "Whitley", 350000, [("920000000000000014", "100", 35.0, False)], split=True, B3_Vacant_Land="Y")
    form(12, "92", "Whitley", 450000, [("920000000000000015", "100", 45.0, False)], B5_Land_Contract_Date="2020-05-01",
         B5_Land_Contract_Term="2020-2026", B3_Vacant_Land="Y")
    b = io.BytesIO()
    z = zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED)
    z.writestr("SALEDISC.txt", tsv(D, HEAD["SALEDISC.txt"]).encode("utf-16"))
    z.writestr("SALEPARCEL.txt", tsv(P, HEAD["SALEPARCEL.txt"]).encode("cp1252"))
    z.writestr("SALECONTAC.txt", tsv(C, HEAD["SALECONTAC.txt"]).encode("utf-16"))
    z.close()
    return b.getvalue()


if __name__ == "__main__":
    a = sys.argv[1:]
    out = a[2] if len(a) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "in-sdf-sample.zip")
    open(out, "wb").write(make(int(a[0]) if a else 100, int(a[1]) if len(a) > 1 else 10000))
